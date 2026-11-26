// Temporary file swaps use an exclusive journal, owner liveness check, and post-write fingerprint.
// Preserve the journal on conflicts or restore failure; never overwrite user changes made during testing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const JOURNAL_DIR = process.env.AGENT_PURGE_JOURNAL_DIR || path.join(os.tmpdir(), "agent-purge-restore");
let installed = false;
const live = new Set();
const hash = (bytes) => bytes === null ? null : createHash("sha256").update(bytes).digest("hex");
const read = (file) => { try { return fs.readFileSync(file); } catch (e) { if (e.code === "ENOENT") return null; throw e; } };
function canonical(file) {
	const full = path.resolve(file);
	// Symlinks to the same directory must share one lock; do not follow nonexistent targets.
	try { return fs.realpathSync(full); } catch (e) {
		if (e.code !== "ENOENT") throw e;
		return path.join(fs.realpathSync(path.dirname(full)), path.basename(full));
	}
}
function entryPath(file) {
	const key = process.platform === "win32" ? file.toLowerCase() : file;
	return path.join(JOURNAL_DIR, createHash("sha256").update(key).digest("hex") + ".json");
}
function alive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return true;
	try { process.kill(pid, 0); return true; } catch (e) { return e.code !== "ESRCH"; }
}
function atomicWrite(file, bytes, mode) {
	const tmp = file + ".purge-" + randomUUID() + ".tmp";
	try {
		fs.writeFileSync(tmp, bytes, { flag: "wx", mode: mode ?? 0o600 });
		fs.renameSync(tmp, file);
	} finally { fs.rmSync(tmp, { force: true }); }
}
const readRecord = (journal) => { try { return JSON.parse(fs.readFileSync(journal, "utf8")); } catch { return null; } };
function restore(record, journal) {
	let currentRecord;
	try {
		const source = fs.readFileSync(journal, "utf8");
		currentRecord = JSON.parse(source);
	} catch (error) {
		throw new Error(`Cannot read recovery credential; file unchanged: ${journal}`, { cause: error });
	}
	if (currentRecord.operation !== record.operation) throw new Error(`Recovery ownership changed: ${record.file}`);
	const current = hash(read(record.file));
	if (current !== record.beforeHash && current !== record.afterHash) {
		throw new Error(`File changed after swap; journal retained for resolution: ${record.file}`);
	}
	if (current !== record.beforeHash) {
		if (record.backup === null) fs.rmSync(record.file, { force: true });
		else atomicWrite(record.file, Buffer.from(record.backup, "base64"), record.mode);
	}
	fs.rmSync(journal);
}

// Undo when already in the target state: no journal to restore; repeated calls are harmless.
const noSwap = () => {};

/** Exclusive swap; returns retryable, idempotent undo. A restore failure throws and preserves the original backup.
 *  Do not write a journal when disk content already matches the target; persistent slash launches reach this each time,
 *  and unconditional exclusivity would block a second session (issue #8). */
export function swapFile(file, content) {
	file = canonical(file);
	const next = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
	const nextHash = hash(next);
	fs.mkdirSync(JOURNAL_DIR, { recursive: true });
	const journal = entryPath(file);
	let fd;
	for (let attempt = 0; ; attempt++) {
		// Content already matches, perhaps written by another session; no swap or lock is needed.
		if (hash(read(file)) === nextHash) return noSwap;
		try { fd = fs.openSync(journal, "wx", 0o600); break; }
		catch (e) {
			if (e.code !== "EEXIST") throw e;
			const holder = readRecord(journal);
			// If the owner exited, reclaim its journal and retry once; report an error if recovery fails.
			if (attempt === 0 && holder?.version === 2 && holder.operation && !alive(holder.pid)) {
				try { restore(holder, journal); continue; }
				catch (error) { throw new Error(`Cannot recover an exited process swap; resolve the journal first: ${file} (${error.message})`); }
			}
			const owner = Number.isInteger(holder?.pid) ? ` (owner PID ${holder.pid})` : "";
			throw new Error(`File has an unfinished swap${owner}; resolve the journal first: ${file}`);
		}
	}
	let record;
	try {
		const backup = read(file);
		record = { version: 2, file, pid: process.pid, operation: randomUUID(), at: new Date().toISOString(),
			backup: backup === null ? null : backup.toString("base64"), beforeHash: hash(backup), afterHash: hash(next),
			mode: backup === null ? undefined : fs.statSync(file).mode & 0o777 };
		fs.writeFileSync(fd, JSON.stringify(record));
		fs.fsyncSync(fd);
		fs.closeSync(fd); fd = undefined;
		atomicWrite(file, next, record.mode);
	} catch (e) {
		if (fd !== undefined) fs.closeSync(fd);
		if (record) { try { restore(record, journal); } catch {} }
		else fs.rmSync(journal, { force: true });
		throw e;
	}
	let done = false;
	const undo = () => {
		if (done) return;
		restore(record, journal);
		done = true;
		live.delete(undo);
	};
	live.add(undo);
	return undo;
}

/** Restore only dead v2 owners; preserve and report old formats whose ownership cannot be proven. */
export function recover({ onWarning = (message) => console.error(`[restore] ${message}`) } = {}) {
	fs.mkdirSync(JOURNAL_DIR, { recursive: true });
	let n = 0;
	for (const name of fs.readdirSync(JOURNAL_DIR)) {
		if (!name.endsWith(".json")) continue;
		const journal = path.join(JOURNAL_DIR, name);
		try {
			const record = JSON.parse(fs.readFileSync(journal, "utf8"));
			if (record.version !== 2 || !record.operation || !path.isAbsolute(record.file || "")) {
				onWarning(`Old or incomplete journal; file not automatically overwritten: ${journal}`); continue;
			}
			if (alive(record.pid)) continue;
			restore(record, journal); n++;
		} catch (e) { onWarning(`${journal}: ${e.message}`); }
	}
	return n;
}

export function installCrashHandlers() {
	if (installed) return;
	installed = true;
	const flush = () => {
		for (const undo of [...live]) {
			try { undo(); } catch (e) { console.error(`[restore] ${e.message}`); }
		}
	};
	for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
		try { process.on(sig, () => { flush(); process.exit(sig === "SIGINT" ? 130 : 143); }); } catch {}
	}
	process.on("uncaughtException", (e) => {
		console.error("[restore] Uncaught exception: ", e?.stack ?? e);
		flush(); process.exit(1);
	});
	process.on("exit", flush);
}
export const journalDir = JOURNAL_DIR;
