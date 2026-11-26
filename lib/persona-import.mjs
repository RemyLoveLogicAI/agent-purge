// Fetch or import personas from external sources (GitHub repositories or local directories) into the local persona library
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createStore, isReservedId } from "./personas.mjs";

const IGNORED_NAMES = new Set([
	"readme.md",
	"readme_zh.md",
	"readme.zh.md",
	"readme.zh-cn.md",
	"license.md",
	"licence.md",
	"changelog.md",
	"contributing.md",
	"security.md",
	"active.md",
]);

/** Normalize the GitHub mirror URL; an empty string means direct access */
export function normalizeMirror(mirror) {
	const raw = String(mirror ?? "").trim();
	if (!raw) return "";
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
	let parsed;
	try {
		parsed = new URL(candidate.replace(/\{(?:url|encodedUrl)\}/g, "https://github.com/"));
	} catch {
		throw new Error("Invalid mirror URL format");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error("Mirror URL must start with http:// or https://");
	}
	if (candidate.includes("{url}") || candidate.includes("{encodedUrl}") || /[?&][^=]+=$/.test(candidate)) {
		return candidate;
	}
	return candidate.replace(/\/+$/, "");
}

/** Rewrite GitHub / raw URLs through the mirror */
export function applyMirror(targetUrl, mirror) {
	const base = normalizeMirror(mirror);
	if (!base) return targetUrl;
	if (base.includes("{encodedUrl}")) return base.replaceAll("{encodedUrl}", encodeURIComponent(targetUrl));
	if (base.includes("{url}")) return base.replaceAll("{url}", targetUrl);
	if (targetUrl === base || targetUrl.startsWith(`${base}/`)) return targetUrl;
	if (/[?&][^=]+=$/.test(base)) return `${base}${encodeURIComponent(targetUrl)}`;
	return `${base}/${targetUrl}`;
}

/** Parse the source string as a local directory or GitHub repository */
export function parseSource(source) {
	const raw = String(source ?? "").trim();
	if (!raw) throw new Error("Import source cannot be empty");

	// 1. Identify local directories by absolute path, relative path prefix, or an existing local directory
	if (
		raw.startsWith("file://") ||
		raw.startsWith(".") ||
		raw.startsWith("/") ||
		/^[A-Za-z]:[\\/]/.test(raw) ||
		existsSync(raw)
	) {
		let cleanPath = raw;
		if (raw.startsWith("file://")) {
			try {
				cleanPath = new URL(raw).pathname;
			} catch {
				cleanPath = raw.slice(7);
			}
		}
		const localDir = resolve(process.cwd(), cleanPath);
		if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
			throw new Error(`Local directory does not exist: ${localDir}`);
		}
		return { kind: "local", path: localDir };
	}

	// 2. GitHub URL (including mirror-prefixed GitHub URLs) or owner/repo format
	let owner = "";
	let repo = "";
	let ref = "main";
	let subpath = "";
	let mirror = "";

	const mirroredMatch = raw.match(/^(https?:\/\/[^/]+)\/(https?:\/\/github\.com\/.+)$/i);
	const targetUrl = mirroredMatch ? mirroredMatch[2] : raw;
	if (mirroredMatch) mirror = normalizeMirror(mirroredMatch[1]);

	if (targetUrl.startsWith("http://") || targetUrl.startsWith("https://")) {
		try {
			const u = new URL(targetUrl);
			if (!u.hostname.includes("github.com")) {
				throw new Error("External fetching currently supports only GitHub repositories or local directories");
			}
			const parts = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
			if (parts.length < 2) throw new Error("Invalid GitHub repository URL");
			owner = parts[0];
			repo = parts[1].replace(/\.git$/i, "");
			if (parts[2] === "tree" && parts[3]) {
				ref = parts[3];
				subpath = parts.slice(4).join("/");
			}
		} catch (e) {
			throw new Error(`Could not parse GitHub URL: ${e.message}`);
		}
	} else {
		// May be "owner/repo", "owner/repo@ref", or "owner/repo/subpath"
		const clean = raw.replace(/\.git$/i, "");
		const [repoPart, refPart] = clean.split("@");
		if (refPart) ref = refPart;

		const parts = repoPart.split("/");
		if (parts.length >= 2) {
			owner = parts[0];
			repo = parts[1];
			if (parts.length > 2) subpath = parts.slice(2).join("/");
		} else {
			throw new Error(`Unrecognized import source: ${raw} (specify owner/repo or a local directory path)`);
		}
	}

	return { kind: "github", owner, repo, ref, subpath, ...(mirror ? { mirror } : {}) };
}

/** Normalize a persona id derived from a filename or frontmatter */
export function sanitizeId(rawId, fallbackName = "persona") {
	let s = String(rawId || "").trim().toLowerCase();
	// Remove invalid characters, replacing them with spaces or hyphens
	s = s.replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
	if (!s || isReservedId(s)) {
		let fb = String(fallbackName || "persona").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
		s = fb && !isReservedId(fb) ? fb : `p-${Date.now().toString(36)}`;
	}
	return s.slice(0, 64);
}

/** Parse frontmatter and prompt body from Markdown */
export function parsePersonaDoc(raw, fallbackId = "") {
	let meta = {};
	let body = raw;

	if (raw.startsWith("---")) {
		const end = raw.indexOf("\n---", 3);
		if (end !== -1) {
			const head = raw.slice(3, end).trim();
			body = raw.slice(end + 4).replace(/^\r?\n/, "");
			meta = parseFrontmatter(head);
		}
	}

	const id = sanitizeId(meta.id || fallbackId, fallbackId);
	const name = meta.name || meta.title || fallbackId || id;
	const description = meta.description || meta.desc || "";
	const harness = Array.isArray(meta.harness) ? meta.harness : ["*"];
	const model = Array.isArray(meta.model) ? meta.model : ["*"];
	const order = typeof meta.order === "number" ? meta.order : 50;

	return {
		id,
		meta: {
			...meta,
			id,
			name,
			description,
			harness,
			model,
			order,
		},
		body: body.trim(),
	};
}

function parseFrontmatter(head) {
	const meta = {};
	let key = null;
	for (const line of head.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const arr = line.match(/^\s*-\s+(.*)$/);
		if (arr && key) {
			if (!Array.isArray(meta[key])) meta[key] = [];
			meta[key].push(unquote(arr[1]));
			continue;
		}
		const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!kv) continue;
		key = kv[1];
		const v = kv[2].trim();
		if (!v) {
			meta[key] = [];
			continue;
		}
		if (v.startsWith("[")) {
			meta[key] = v
				.replace(/^\[|\]$/g, "")
				.split(",")
				.map((s) => unquote(s.trim()))
				.filter(Boolean);
		} else {
			meta[key] = coerce(v);
		}
	}
	return meta;
}

const unquote = (s) => s.replace(/^["']|["']$/g, "");
const coerce = (v) => {
	if (v === "true") return true;
	if (v === "false") return false;
	const n = Number(v);
	return Number.isFinite(n) && !Number.isNaN(n) && String(n) === v ? n : unquote(v);
};

/** Import personas from a local directory */
export function importFromDirectory(dirPath, root, { overwrite = true } = {}) {
	const resolvedDir = resolve(dirPath);
	if (!existsSync(resolvedDir)) throw new Error(`Directory does not exist: ${resolvedDir}`);

	const entries = readdirSync(resolvedDir, { withFileTypes: true });
	const store = createStore(root);
	const imported = [];
	const skipped = [];
	const errors = [];

	for (const entry of entries) {
		if (entry.isDirectory()) continue;
		const name = entry.name;
		const lower = name.toLowerCase();
		if (!lower.endsWith(".md") && !lower.endsWith(".markdown")) continue;
		if (IGNORED_NAMES.has(lower) || lower.startsWith(".")) {
			skipped.push({ file: name, reason: "Ignored filename (documentation or hidden file)" });
			continue;
		}

		try {
			const filePath = join(resolvedDir, name);
			const raw = readFileSync(filePath, "utf8");
			const fallbackId = basename(name, extname(name));
			const parsed = parsePersonaDoc(raw, fallbackId);

			if (!parsed.body) {
				skipped.push({ file: name, reason: "Prompt body is empty" });
				continue;
			}

			const existing = store.read(parsed.id);
			if (existing && !overwrite) {
				skipped.push({ id: parsed.id, name: parsed.meta.name, file: name, reason: "Already exists and overwrite is disabled" });
				continue;
			}

			const saved = store.save(parsed.id, { meta: parsed.meta, body: parsed.body });
			imported.push({
				id: saved.id,
				name: saved.meta.name,
				chars: saved.body.length,
				action: existing ? "updated" : "created",
			});
		} catch (e) {
			errors.push({ file: name, error: e.message });
		}
	}

	return {
		success: errors.length === 0,
		source: { kind: "local", path: resolvedDir },
		imported,
		skipped,
		errors,
		total: imported.length,
	};
}

/** Fetch personas from a GitHub repository */
export async function pullFromGitHub(
	{ owner, repo, ref = "main", subpath = "", mirror: sourceMirror = "" },
	root,
	{ overwrite = true, token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN, mirror } = {}
) {
	const store = createStore(root);
	const activeMirror = normalizeMirror(mirror || sourceMirror);
	const headers = {
		"User-Agent": "agent-purge-client",
		Accept: "application/vnd.github.v3+json",
	};
	// Never send the GitHub token to third-party mirrors, to avoid credential disclosure
	if (token && !activeMirror) headers.Authorization = `Bearer ${token}`;

	const apiPath = subpath ? `contents/${encodeURIComponent(subpath).replace(/%2F/g, "/")}` : "contents";
	const apiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${apiPath}?ref=${encodeURIComponent(ref)}`;
	const url = applyMirror(apiUrl, activeMirror);

	let res;
	try {
		res = await fetch(url, { headers });
	} catch (e) {
		throw new Error(`GitHub connection failed${activeMirror ? ` (mirror ${activeMirror})` : ""}: ${e.message}`);
	}

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub API returned ${res.status}: ${text.slice(0, 200)}`);
	}

	const list = await res.json();
	if (!Array.isArray(list)) {
		throw new Error("The specified GitHub repository path is not a file listing");
	}

	const imported = [];
	const skipped = [];
	const errors = [];

	for (const item of list) {
		if (item.type !== "file") continue;
		const name = item.name;
		const lower = name.toLowerCase();
		if (!lower.endsWith(".md") && !lower.endsWith(".markdown")) continue;
		if (IGNORED_NAMES.has(lower) || lower.startsWith(".")) {
			skipped.push({ file: name, reason: "Ignored filename (documentation or hidden file)" });
			continue;
		}

		try {
			let content = "";
			// Prefer download_url (raw); on failure fall back to git_url for the base64 blob
			if (item.download_url) {
				try {
					const r = await fetch(applyMirror(item.download_url, activeMirror), { headers: { "User-Agent": "agent-purge-client" } });
					if (r.ok) content = await r.text();
				} catch {
					// Ignore raw failure and fall back to the blob
				}
			}

			if (!content && item.git_url) {
				const blobRes = await fetch(applyMirror(item.git_url, activeMirror), { headers });
				if (blobRes.ok) {
					const blobData = await blobRes.json();
					if (blobData.content && blobData.encoding === "base64") {
						content = Buffer.from(blobData.content, "base64").toString("utf8");
					}
				}
			}

			if (!content) throw new Error("Could not read file contents");

			const fallbackId = basename(name, extname(name));
			const parsed = parsePersonaDoc(content, fallbackId);

			if (!parsed.body) {
				skipped.push({ file: name, reason: "Prompt body is empty" });
				continue;
			}

			const existing = store.read(parsed.id);
			if (existing && !overwrite) {
				skipped.push({ id: parsed.id, name: parsed.meta.name, file: name, reason: "Already exists and overwrite is disabled" });
				continue;
			}

			const saved = store.save(parsed.id, { meta: parsed.meta, body: parsed.body });
			imported.push({
				id: saved.id,
				name: saved.meta.name,
				chars: saved.body.length,
				action: existing ? "updated" : "created",
			});
		} catch (e) {
			errors.push({ file: name, error: e.message });
		}
	}

	return {
		success: errors.length === 0,
		source: { kind: "github", owner, repo, ref, subpath, ...(activeMirror ? { mirror: activeMirror } : {}) },
		imported,
		skipped,
		errors,
		total: imported.length,
	};
}

/** Unified entry point: route imports automatically according to source */
export async function importPersonas(sourceStr, root, options = {}) {
	const parsed = parseSource(sourceStr);
	if (parsed.kind === "local") {
		return importFromDirectory(parsed.path, root, options);
	}
	return pullFromGitHub(parsed, root, options);
}
