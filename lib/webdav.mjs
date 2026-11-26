// WebDAV backup: serialize personas and settings into a JSON archive and PUT it remotely; restore downloads, validates, then writes it.
//
// Three design constraints:
//   1. Backups contain personas and settings only, not runtime logs, locks, caches, or browser profiles;
//   2. Snapshot the current data directory locally in backups/ before restoring, allowing recovery from accidental restores;
//   3. Use WebDAV methods without external dependencies.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";


export const MANIFEST = "agent-purge-backup.json";
const FORMAT = 1;
const MAX_DOWNLOAD = 32 * 1024 * 1024;
const TIMEOUT = 20000;

/** Files included in the backup relative to the data directory: persona library and configuration. */
function backupFiles(root) {
	const files = [];
	const personas = join(root, "personas");
	if (existsSync(personas)) {
		for (const name of readdirSync(personas)) {
			// .build/ is derived, and active.md is generated from the persona field in state.json; omit both.
			if (!name.endsWith(".md") || name === "active.md") continue;
			files.push({ path: `personas/${name}`, bytes: readFileSync(join(personas, name)) });
		}
	}
	const stateFile = join(root, "state.json");
	if (existsSync(stateFile) && statSync(stateFile).isFile()) {
		files.push({ path: "state.json", bytes: Buffer.from(sanitizedState(readFileSync(stateFile, "utf8"))) });
	}
	const ledger = join(root, "footprints.json");
	if (existsSync(ledger) && statSync(ledger).isFile()) files.push({ path: "footprints.json", bytes: readFileSync(ledger) });
	return files;
}

/**
 * Remove the WebDAV password from backed-up state.json because backups leave this machine;
 * credentials belong to this machine’s remote connection, not the persona.
 */
function sanitizedState(raw) {
	let state;
	try { state = JSON.parse(raw); } catch { return raw; }
	if (state?.settings?.webdav?.password) {
		const webdav = { ...state.settings.webdav };
		delete webdav.password;
		state = { ...state, settings: { ...state.settings, webdav } };
	}
	return JSON.stringify(state, null, 2) + "\n";
}

/** Join a remote URL from base and path segments, dropping empty segments. */
function joinRemote(baseUrl, ...parts) {
	const base = String(baseUrl ?? "").trim().replace(/\/+$/, "");
	const segments = parts
		.flatMap(part => String(part ?? "").split("/"))
		.map(s => s.trim())
		.filter(Boolean);
	return [base, ...segments].filter(Boolean).join("/");
}

/** Remote URL: base + directory + filename, dropping empty directory segments. */
export function remoteUrl({ url, dir }, file) {
	return joinRemote(url, dir, file);
}

function authHeader({ username, password }) {
	if (!username && !password) return {};
	return { authorization: `Basic ${Buffer.from(`${username ?? ""}:${password ?? ""}`).toString("base64")}` };
}

async function requestUrl(settings, method, target, { body, headers = {}, timeout = TIMEOUT } = {}) {
	let response;
	try {
		response = await fetch(target, {
			method,
			headers: { ...authHeader(settings), ...headers },
			body,
			signal: AbortSignal.timeout(timeout),
		});
	} catch (error) {
		const reason = error?.cause?.code || error?.name || "network";
		throw new Error(`Could not connect to WebDAV (${reason}): ${target}`);
	}
	return response;
}

async function request(settings, method, file, opts = {}) {
	return requestUrl(settings, method, remoteUrl(settings, file), opts);
}

/** Ensure each remote collection exists (WebDAV MKCOL is not recursive); 405 means it already exists. */
async function ensureCollection(settings, subDir = "") {
	const segments = [settings.dir, subDir]
		.flatMap(part => String(part ?? "").split("/"))
		.map(s => s.trim())
		.filter(Boolean);
	const built = [];
	for (const seg of segments) {
		built.push(seg);
		const target = `${joinRemote(settings.url, ...built)}/`;
		const res = await requestUrl(settings, "MKCOL", target).catch(() => null);
		if (res?.status === 401 || res?.status === 403) {
			throw new Error("WebDAV rejected these credentials (401/403)");
		}
	}
}

/** Read-only probe: reading the remote directory establishes connectivity and validates credentials. */
export async function testConnection(rawSettings) {
	const settings = rawSettings.webdav ?? rawSettings;
	if (!settings.url) throw new Error("WebDAV URL has not been set");
	const dirUrl = remoteUrl(settings, "");
	const response = await requestUrl(settings, "PROPFIND", `${dirUrl}/`, { headers: { depth: "0" }, timeout: 15000 });
	if (response.status === 401 || response.status === 403) throw new Error("WebDAV rejected these credentials (401/403)");
	// On initial setup the subdirectory may not exist; probe the base URL instead to check connectivity and credentials.
	if (response.status === 404 && String(settings.dir ?? "").trim()) {
		const baseRes = await requestUrl(settings, "PROPFIND", `${joinRemote(settings.url)}/`, { headers: { depth: "0" }, timeout: 15000 });
		if (baseRes.status === 401 || baseRes.status === 403) throw new Error("WebDAV rejected these credentials (401/403)");
		if (baseRes.ok || baseRes.status === 207) return { ok: true, url: dirUrl, willCreateDir: true };
	}
	if (!response.ok && response.status !== 207) throw new Error(`WebDAV returned ${response.status}; check the URL`);
	return { ok: true, url: dirUrl };
}

/**
 * Package and upload. The fixed remote filename is overwritten with the latest backup; also keep a timestamped copy
 * so an accidental backup does not erase the only historical copy.
 */
export async function backup(root, rawSettings) {
	const settings = rawSettings.webdav ?? rawSettings;
	if (!settings.url) throw new Error("WebDAV URL has not been set");
	const files = backupFiles(root);
	if (!files.length) throw new Error("No personas or configuration in the data directory to back up");
	const entries = files.map(file => ({
		path: file.path,
		size: file.bytes.length,
		sha256: createHash("sha256").update(file.bytes).digest("hex"),
		base64: file.bytes.toString("base64"),
	}));
	const createdAt = new Date().toISOString();
	const archive = {
		format: FORMAT,
		createdAt,
		version: (() => { try { return JSON.parse(readFileSync(join(root, "state.json"), "utf8")).version ?? null; } catch { return null; } })(),
		entries,
	};
	const body = Buffer.from(JSON.stringify(archive));
	const stamp = createdAt.replace(/[:.]/g, "-");
	const names = [`${MANIFEST}`, `history/agent-purge-${stamp}.json`];

	for (const name of names) {
		let response = await request(settings, "PUT", name, {
			body,
			headers: { "content-type": "application/json" },
		});
		// Directory absent: MKCOL each segment from settings.dir through history, then retry once.
		if (response.status === 404 || response.status === 409) {
			const slash = name.lastIndexOf("/");
			const subDir = slash > 0 ? name.slice(0, slash) : "";
			await ensureCollection(settings, subDir);
			response = await request(settings, "PUT", name, { body, headers: { "content-type": "application/json" } });
		}
		if (!response.ok) throw new Error(`Upload of ${name} failed: HTTP ${response.status}`);
	}
	return { ok: true, files: entries.length, bytes: body.length, at: createdAt, remote: remoteUrl(settings, MANIFEST) };
}

/** Download and validate: reject hash mismatches to prevent incomplete files from overwriting local personas. */
export async function download(rawSettings) {
	const settings = rawSettings.webdav ?? rawSettings;
	if (!settings.url) throw new Error("WebDAV URL has not been set");
	const response = await request(settings, "GET", MANIFEST);
	if (response.status === 401 || response.status === 403) throw new Error("WebDAV rejected these credentials (401/403)");
	if (response.status === 404) throw new Error("No agent-purge backup found remotely");
	if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
	const length = Number(response.headers.get("content-length") ?? 0);
	if (length > MAX_DOWNLOAD) throw new Error(`Backup exceeds ${MAX_DOWNLOAD / 1024 / 1024} MiB; refusing download`);
	const text = await response.text();
	if (Buffer.byteLength(text) > MAX_DOWNLOAD) throw new Error("Abnormal backup size; refusing to write");
	let archive;
	try { archive = JSON.parse(text); } catch { throw new Error("Remote backup is not valid JSON"); }
	if (archive?.format !== FORMAT || !Array.isArray(archive.entries)) throw new Error("Unrecognized remote backup format (possibly from a newer version)");
	return { archive, entries: verifiedEntries(archive) };
}

/**
 * Validate entries and decode base64 to bytes.
 * Shared because the persona-and-two-config-files restriction applies to backup, download, and restore.
 */
function verifiedEntries(archive) {
	const verified = [];
	for (const entry of archive.entries) {
		const path = assertBackupPath(entry?.path);
		const bytes = Buffer.from(String(entry.base64 ?? ""), "base64");
		const sha = createHash("sha256").update(bytes).digest("hex");
		if (sha !== entry.sha256) throw new Error(`${path} verification failed (file may be corrupt)`);
		verified.push({ path, bytes });
	}
	return verified;
}

/** Allow only personas and two configuration files; remote backup paths must not escape the data directory. */
function assertBackupPath(path) {
	const value = String(path ?? "");
	if (!/^(personas\/[^/\\]+\.md|state\.json|footprints\.json)$/.test(value) || value.includes("..")) {
		throw new Error(`Unrecognized path in backup: ${value}`);
	}
	return value;
}

/** Snapshot the current data directory in backups/ before restore; restore may continue if snapshotting fails. */
function snapshot(root) {
	const dir = join(root, "backups");
	mkdirSync(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const target = join(dir, `pre-restore-${stamp}.json`);
	const files = backupFiles(root).map(file => ({ path: file.path, base64: file.bytes.toString("base64") }));
	writeFileSync(target, JSON.stringify({ format: FORMAT, createdAt: new Date().toISOString(), entries: files }, null, 2));
	return target;
}

/**
 * Write the validated downloaded backup to the data directory synchronously; callers must hold the configuration lock
 * to prevent concurrent writes with persona saves or configuration application.
 * Touch only files in the backup, leaving other personas intact.
 */
export function applyArchive(root, downloaded, { snapshotBefore = true } = {}) {
	// Entries may be bytes from download() or raw base64; validate both again here.
	const entries = downloaded.entries.map(entry => {
		const path = assertBackupPath(entry?.path);
		if (Buffer.isBuffer(entry.bytes)) return { path, bytes: entry.bytes };
		const bytes = Buffer.from(String(entry.base64 ?? ""), "base64");
		if (entry.sha256 && createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
			throw new Error(`${path} verification failed (file may be corrupt)`);
		}
		return { path, bytes };
	});
	const archive = downloaded.archive ?? {};
	const snapshotPath = snapshotBefore ? snapshot(root) : null;
	const before = (() => { try { return JSON.parse(readFileSync(join(root, "state.json"), "utf8")); } catch { return null; } })();
	const keepWebdav = before?.settings?.webdav ?? null;
	mkdirSync(join(root, "personas"), { recursive: true });
	const written = [];
	for (const entry of entries) {
		writeFileSync(join(root, entry.path), entry.bytes, { mode: entry.path === "state.json" ? 0o600 : 0o644 });
		written.push(entry.path);
	}
	// Backed-up state.json deliberately excludes passwords; preserve this machine’s WebDAV credentials after restore.
	if (keepWebdav && written.includes("state.json")) {
		const after = JSON.parse(readFileSync(join(root, "state.json"), "utf8"));
		after.settings = { ...(after.settings ?? {}), webdav: { ...keepWebdav } };
		writeFileSync(join(root, "state.json"), `${JSON.stringify(after, null, 2)}\n`, { mode: 0o600 });
	}
	return { ok: true, written, at: archive.createdAt ?? null, snapshot: snapshotPath };
}

/** One-step restore (download + write); use download + applyArchive when the configuration lock is needed. */
export async function restore(root, rawSettings, options = {}) {
	const settings = rawSettings.webdav ?? rawSettings;
	const downloaded = await download(settings);
	return applyArchive(root, downloaded, options);
}

/** Remove expired local backups/ snapshots, retaining only the most recent ones. */
export function pruneSnapshots(root, keep = 10) {
	const dir = join(root, "backups");
	if (!existsSync(dir)) return 0;
	const files = readdirSync(dir).filter(name => name.startsWith("pre-restore-") && name.endsWith(".json")).sort();
	const drop = files.slice(0, Math.max(0, files.length - keep));
	for (const name of drop) rmSync(join(dir, name), { force: true });
	return drop.length;
}


