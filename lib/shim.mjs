// Bare-command takeover: put same-named shims first in PATH so `codex` runs `agent-purge codex`.
//
// The shim writes the real binary path to AGENT_PURGE_REAL_BIN, which spawn prioritizes;
// otherwise the resolver finds the shim itself first and recurses indefinitely.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ownShimDirectory } from "./environment.mjs";
import { looksOwned, removeOwnedFile } from "./persist.mjs";
import { record } from "./footprints.mjs";

const WIN = process.platform === "win32";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = ownShimDirectory();
// Keep the same priority as spawn SPAWN_EXTS: .ps1 passes arguments as a PowerShell array,
// avoiding cmd.exe %VAR% expansion; .cmd is only a fallback.
const EXTS = WIN ? [".exe", ".ps1", ".cmd", ".bat"] : [""];

export function shimDir() {
	return DIR;
}

/** Invocation prefix for this tool: Bun-compiled builds use their own exe; Node builds include the script path */
function selfPrefix() {
	if (process.versions.bun) return { cmd: process.execPath, args: [] };
	return { cmd: process.execPath, args: [join(ROOT, "bin", "agent-purge.mjs")] };
}

/** Find same-named executable on PATH, skipping our own shim directory */
export function resolveReal(id) {
	const dirs = (process.env.PATH ?? "").split(WIN ? ";" : ":").filter(Boolean);
	for (const d of dirs) {
		if (resolve(d) === resolve(DIR)) continue;
		for (const ext of EXTS) {
			const p = join(d, id + ext);
			if (existsSync(p)) return p;
		}
	}
	return null;
}

export function installShim(root, id) {
	const real = resolveReal(id);
	if (!real) return { error: `Could not find the real ${id} on PATH (see agent-purge doctor for detection results)` };
	mkdirSync(DIR, { recursive: true });
	for (const name of WIN ? [`${id}.cmd`, `${id}.ps1`] : [id]) {
		const file = join(DIR, name);
		if (existsSync(file) && !looksOwned(readFileSync(file, "utf8"))) return { error: `Same-named file is not a managed shim: ${file}` };
	}
	const self = selfPrefix();
	const files = [];
	// Do not collapse spaces when concatenating: node.exe is often under "C:\Program Files\..."
	const callLine = [`"${self.cmd}"`, ...self.args.map((a) => `"${a}"`), id].join(" ");

	if (WIN) {
		const cmdFile = join(DIR, `${id}.cmd`);
		writeFileSync(
			cmdFile,
			[
				"@echo off",
				"rem agent-purge shim — Delete this file to stop the takeover",
				`set "AGENT_PURGE_REAL_BIN=${real}"`,
				`${callLine} %*`,
				"",
			].join("\r\n"),
			"utf8",
		);
		files.push(cmdFile);

		const psFile = join(DIR, `${id}.ps1`);
		writeFileSync(
			psFile,
			[
				"# agent-purge shim — Delete this file to stop the takeover",
				`$env:AGENT_PURGE_REAL_BIN = '${real.replace(/'/g, "''")}'`,
				`& '${self.cmd}' ${self.args.map((a) => `'${a}'`).join(" ")} ${id} @args`,
				"exit $LASTEXITCODE",
				"",
			].join("\r\n"),
			"utf8",
		);
		files.push(psFile);
	} else {
		const sh = join(DIR, id);
		writeFileSync(
			sh,
			[
				"#!/bin/sh",
				"# agent-purge shim — Delete this file to stop the takeover",
				`AGENT_PURGE_REAL_BIN='${real.replace(/'/g, "'\\''")}' exec '${self.cmd}' ${self.args.map((a) => `'${a}'`).join(" ")} ${id} "$@"`,
				"",
			].join("\n"),
			{ encoding: "utf8", mode: 0o755 },
		);
		files.push(sh);
	}

	// Use the ledger for uninstall: scanning bin/ by filename misses renamed orphans.
	for (const f of files) record(root, { kind: "file", harness: id, channel: "shim", path: f, undo: { type: "file-delete" } });
	record(root, { kind: "path", harness: id, channel: "shim", path: DIR, undo: { type: "path-env" } });
	// The Web shim toggle must also add the directory to PATH, otherwise bare commands still run the original program.
	const path = ensureUserPath();
	return { file: files[0], files, real, path };
}
export function uninstallShim(root, id) {
	// A missing shim is not necessarily failure: state may record an armed entry that is absent here (another machine or manual deletion).
	// Returning an error here makes clean report permanent leftovers such as an unremovable codebuddy:shim.
	if (!existsSync(DIR)) return { action: "already-gone", detail: `Shim directory does not exist: ${DIR}` };
	const removed = [];
	for (const f of readdirSync(DIR)) {
		const base = f.replace(/\.(cmd|ps1|bat|exe)$/i, "");
		if (base === id) {
			const file = join(DIR, f);
			const r = removeOwnedFile(file, { root });
			if (r.action === "skipped-foreign") return { error: `Preserved foreign file: ${file}`, removed };
			removed.push(file);
		}
	}
	if (!removed.length) return { action: "already-gone", detail: `No shim for ${id}` };
	return { file: removed[0], removed, action: "deleted-file" };
}

export function shimStatus() {
	if (!existsSync(DIR)) return [];
	const seen = new Map();
	for (const f of readdirSync(DIR)) {
		let owned = false;
		try { owned = looksOwned(readFileSync(join(DIR, f), "utf8")); } catch {}
		if (!owned) continue;
		const id = f.replace(/\.(cmd|ps1|bat|exe)$/i, "");
		if (!seen.has(id)) seen.set(id, { id, installed: true, dir: DIR, files: [] });
		seen.get(id).files.push(join(DIR, f));
	}
	return [...seen.values()];
}

/** Read-only: whether the shim directory is first in the user PATH. Used by status; does not write the registry. */
export function pathState() {
	if (!WIN || process.env.AGENT_PURGE_ISOLATED === "1") {
		const parts = (process.env.PATH ?? "").split(WIN ? ";" : ":");
		return { dir: DIR, present: parts.includes(DIR), first: parts[0] === DIR };
	}
	const read = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User')"], { encoding: "utf8", windowsHide: true });
	const parts = (read.stdout ?? "").trim().split(";").filter(Boolean);
	const norm = (s) => resolve(s.trim().replace(/\\{2,}/g, "\\")).toLowerCase();
	const at = parts.findIndex((p) => norm(p) === norm(DIR));
	return { dir: DIR, present: at >= 0, first: at === 0 && parts[0].trim() === DIR };
}

/**
 * Put the shim directory first in the user PATH (idempotent). On Windows use [Environment]::SetEnvironmentVariable,
 * not setx (which truncates at more than 1024 characters).
 */
export function ensureUserPath() {
	if (!WIN || process.env.AGENT_PURGE_ISOLATED === "1") return { changed: false, dir: DIR, how: `Add ${DIR} to the front of PATH in the shell rc: export PATH="${DIR}:$PATH"`, first: false };
	const read = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User')"], { encoding: "utf8", windowsHide: true });
	const current = (read.stdout ?? "").trim();
	const parts = current.split(";").filter(Boolean);
	// Collapse consecutive backslashes: an earlier version wrote "C:\\Users\\..." with double backslashes to PATH,
	// which must be normalized to recognize and clean the same entry.
	const norm = (s) => resolve(s.trim().replace(/\\{2,}/g, "\\"));
	const at = parts.findIndex((p) => norm(p).toLowerCase() === norm(DIR).toLowerCase());
	// Correct position is not enough: verify that the stored path is clean (it was once written as "C:\\\\Users\\\\...", where position was correct but where could not find it).
	const clean = at === 0 && parts[0].trim() === DIR;
	if (clean) return { changed: false, dir: DIR, first: true, how: "Already first" };

	const next = [DIR, ...parts.filter((p) => norm(p).toLowerCase() !== norm(DIR).toLowerCase())];
	// PowerShell single quotes are literal: surround with single quotes and double internal single quotes. Never use JSON.stringify
	// (JSON turns \\ 写成 \\\\, producing an unusable double-backslash PATH entry).
	const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;
	const write = spawnSync(
		"powershell",
		["-NoProfile", "-Command", `[Environment]::SetEnvironmentVariable('Path', ${psQuote(next.join(";"))}, 'User')`],
		{ encoding: "utf8", windowsHide: true },
	);
	if (write.status !== 0) return { changed: false, dir: DIR, first: false, how: `Failed to write user PATH: ${(write.stderr ?? "").trim()}` };
	return { changed: true, dir: DIR, first: true, how: at === 0 ? "Corrected the malformed PATH entry in place" : "Added to user PATH (effective in a new terminal; disarm does not remove it automatically)" };
}

/** Remove the entry added by ensureUserPath only, preserving all other entries */
export function removeUserPath(dir = DIR) {
	if (!WIN || process.env.AGENT_PURGE_ISOLATED === "1") {
		const present = (process.env.PATH ?? "").split(WIN ? ";" : ":").some(p => resolve(p || ".").toLowerCase() === resolve(dir).toLowerCase());
		return { ok: !present, changed: false, dir, how: present ? `Remove ${dir} from shell rc` : "Directory is no longer in PATH" };
	}
	const read = spawnSync("powershell", ["-NoProfile", "-Command", "[Environment]::GetEnvironmentVariable('Path','User')"], { encoding: "utf8", windowsHide: true });
	if (read.status !== 0) return { ok: false, changed: false, dir, how: `Failed to read user PATH: ${read.stderr ?? ""}` };
	const parts = (read.stdout ?? "").trim().split(";").filter(Boolean);
	const norm = (s) => resolve(s.trim().replace(/\\{2,}/g, "\\")).toLowerCase();
	const left = parts.filter((p) => norm(p) !== norm(dir));
	if (left.length === parts.length) return { ok: true, changed: false, dir, how: "Not in user PATH" };
	// If ours is the only PATH entry, do not write an empty value: that clears the user PATH rather than undoing our change.
	if (!left.length) return { ok: false, changed: false, dir, how: "User PATH has only this entry; manually confirm clearing it" };
	const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;
	const write = spawnSync(
		"powershell",
		["-NoProfile", "-Command", `[Environment]::SetEnvironmentVariable('Path', ${psQuote(left.join(";"))}, 'User')`],
		{ encoding: "utf8", windowsHide: true },
	);
	if (write.status !== 0) return { ok: false, changed: false, dir, how: `Failed to write user PATH: ${(write.stderr ?? "").trim()}` };
	return { ok: true, changed: true, dir, how: "Removed from user PATH (effective in a new terminal)" };
}
