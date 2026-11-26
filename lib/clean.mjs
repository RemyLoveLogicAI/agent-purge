// Cleanup first publishes a global pause, then restores registered changes individually; failures retain the ledger and stash in place for retry.
import { existsSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, resolve, sep } from "node:path";
import { changeChannel } from "./apply.mjs";
import { withControlLock } from "./control.mjs";
import { cancel, listLedger } from "./footprints.mjs";
import { removeOwnedFile, revertFile, uninstall as uninstallPersist } from "./persist.mjs";
import { removeUserPath, shimDir } from "./shim.mjs";
import { loadState, patchState } from "./state.mjs";

/**
 * Undo all injections and restore modified files.
 *
 * keepFailed: unrestoreable old files or custom ledger entries are marked skipped; CLI exits with code 3.
 * Failures in configuration, ledger reading, active channels, PATH, or finalization still block uninstall. Ledger and backups stay in place,
 * and the caller records skipped items (the CLI writes clean-leftovers.log), allowing retries.
 */
export function clean(root, { all = false, dryRun = false, keepProject = false, keepFailed = false } = {}) {
	// Reject dangerous data roots before creating a lock or writing paused state, not halfway through cleanup.
	const blocked = all && refuseReason(resolve(root));
	if (blocked) return { ok: false, steps: [{ what: "data-home", ok: false, detail: blocked }], leftovers: [blocked], skipped: [] };
	if (dryRun) return runClean(root, { all, dryRun, keepProject, keepFailed });
	return withControlLock(root, () => runClean(root, { all, dryRun, keepProject, keepFailed }));
}
function runClean(root, { all, dryRun, keepProject, keepFailed }) {
	const steps = [], skipped = [], home = resolve(root);
	let blocked = false;
	const add = (what, work, { fatal = false } = {}) => {
		try {
			const detail = work();
			if (detail?.error || detail?.ok === false || detail?.status === "failed") throw new Error(detail.error ?? JSON.stringify(detail));
			steps.push({ what, ok: true, detail });
			return true;
		} catch (error) {
			const step = { what, ok: false, detail: error.message };
			steps.push(step);
			// Only explicit --keep-failed tolerates failures; finalization such as data directory deletion always fails hard.
			if (!keepFailed || fatal) { blocked = true; return false; }
			skipped.push(step);
			return false;
		}
	};
	let state;
	if (!add("pause", () => {
		state = loadState(root, { migrate: !dryRun }).state;
		if (dryRun) return "(dry-run: would pause first and revoke session launch credentials)";
		patchState(root, { default: { harness: state.default?.harness ?? null, mode: "off" },
			resumeMode: state.default?.mode && state.default.mode !== "off" ? state.default.mode : state.resumeMode ?? "replace" });
		return "Paused; old launch credentials will not be restored";
	}, { fatal: true })) return { ok: false, steps, leftovers: ["Configuration could not be paused; cleanup was not started"], skipped };

	// If the ledger cannot be read, the files needing restoration are unknown; do not revoke channels and then skip corrupted credentials as old records.
	let entries = [];
	if (!add("read-ledger", () => { entries = listLedger(root); return `${entries.length} restoration records`; }, { fatal: true }))
		return { ok: false, steps, leftovers: ["Could not read the footprint ledger; cleanup was not started"], skipped };

	for (const [harness, channels] of Object.entries(state.armed ?? {})) {
		for (const channel of Array.isArray(channels) ? channels : []) {
      if (keepProject && channel === "project") continue;
			// Failure to revoke an active channel is not a stale ledger entry; uninstall must stop and preserve the program.
			add(`${harness}/${channel}`, () => dryRun ? "(dry-run: would revoke)" : changeChannel(root, { harness, channel, enabled: false }), { fatal: true });
		}
	}
	// Channel revocation restores files and clears ledger entries; do not replay the preflight snapshot or newly restored user files would be treated as managed files.
	if (!dryRun && !add("refresh-ledger", () => { entries = listLedger(root); return `${entries.length} remaining restoration records`; }, { fatal: true }))
		return { ok: false, steps, leftovers: ["Could not read the ledger after cleanup; restoration credentials were preserved"], skipped };
	const customDone = new Set();
	for (const entry of [...entries].reverse()) {
    if (keepProject && entry.channel === "project") continue;
		if (dryRun) { steps.push({ what: `ledger:${entry.undo.type}`, ok: true, detail: `(dry-run: would undo ${entry.path})` }); continue; }
		if (entry.undo.type === "custom" && customDone.has(entry.harness)) continue;
		add(`ledger:${entry.undo.type}`, () => {
			let detail;
			if (entry.undo.type === "custom") {
				customDone.add(entry.harness);
				detail = uninstallPersist(entry.harness, { root });
			} else detail = reverse(entry, root);
			if (detail?.error || detail?.ok === false) throw new Error(detail.error ?? JSON.stringify(detail));
			cancel(root, { id: entry.id, kind: entry.kind, path: entry.path, harness: entry.harness, channel: entry.channel });
			return detail;
		}, { fatal: !["custom", "file-delete", "block-revert"].includes(entry.undo.type) });
	}
	// User files may coexist in the directory; remove only empty directories, never recursively delete unknown files.
	if (existsSync(shimDir())) add("shim-dir", () => {
		if (dryRun) return "(dry-run: remove only empty directories and preserve foreign files)";
		if (readdirSync(shimDir()).length) return "Preserved unregistered files in the directory";
		rmdirSync(shimDir());
		return "removed-empty-directory";
	}, { fatal: true });
	if (!dryRun && steps.every(s => s.ok)) add("reset-selection", () => {
		const kept = {};
		if (keepProject) for (const [harness, channels] of Object.entries(state.armed ?? {})) {
			const projects = (Array.isArray(channels) ? channels : []).filter(channel => channel === "project");
			if (projects.length) kept[harness] = projects;
		}
		return patchState(root, { armed: keepProject ? kept : {}, pausedInstalls: [], projectDirs: keepProject ? state.projectDirs ?? {} : {} });
	}, { fatal: true });
	let pending = leftovers(root, { keepProject, dryRun });
	if (all) add("data-home", () => {
		const blocked = refuseReason(home);
		if (blocked) throw new Error(blocked);
		if (dryRun) return `(dry-run: delete ${home} after confirming complete restoration)`;
		if (pending.length || steps.some(s => !s.ok)) throw new Error(`Preserved original data directory for retry: ${home}; ${pending.join("；")}`);
		if (!existsSync(home)) return "already-gone";
		const trash = `${home}.trash-${Date.now()}`;
		renameSync(home, trash);
		try { rmSync(trash, { recursive: true, force: true }); }
		catch (error) {
			try { if (!existsSync(home)) renameSync(trash, home); } catch {}
			throw new Error(`Deletion failed; recovery data preserved at ${existsSync(home) ? home : trash}: ${error.message}`);
		}
		return home;
	}, { fatal: true });
	pending = leftovers(root, { keepProject, dryRun });
	// With keepFailed, pending entries are the skipped records already recorded in skipped and do not make the result a failure.
	const ok = !blocked && (dryRun || !pending.length || (keepFailed && skipped.length > 0));
	return { ok, steps, leftovers: pending, skipped };
}
function refuseReason(home) {
	const canonical = file => {
		let full = resolve(file);
		try { full = realpathSync(full); } catch (error) { if (error.code !== "ENOENT") throw error; }
		return process.platform === "win32" ? full.toLowerCase() : full;
	};
	const h = canonical(home), cwd = canonical(process.cwd());
	const contains = file => file === h || file.startsWith(h.endsWith(sep) ? h : h + sep);
	if (contains(cwd)) return `Current working directory is inside the data directory; handle manually: ${home}`;
	const protectedDirs = [process.env.USERPROFILE || process.env.HOME || homedir(), homedir(), tmpdir()];
	if (protectedDirs.some(file => contains(canonical(file))) || !basename(h) || /^[A-Za-z]:[\\/]?$/.test(h) || h === sep)
		return `Data directory points to the user home, temporary root, or a parent; handle manually: ${home}`;
	return null;
}
function reverse(entry, root) {
	if (entry.undo.type === "file-delete") {
		const result = removeOwnedFile(entry.path, { root, expectedSha: entry.sha256 });
		if (result.action === "skipped-foreign") throw new Error(`Preserved foreign file and restoration record: ${entry.path}`);
		return result;
	}
	if (entry.undo.type === "block-revert") return revertFile(entry.path, { root });
	if (entry.undo.type === "path-env") return removeUserPath(entry.path);
	throw new Error(`Unknown undo method; ledger preserved: ${entry.undo.type}`);
}
function leftovers(root, { keepProject = false, dryRun = false } = {}) {
	if (!existsSync(root)) return [];
	const out = [];
	try {
		const pending = listLedger(root).filter(entry => !(keepProject && entry.channel === "project"));
		if (pending.length) out.push(`${pending.length} ledger records not undone (${pending.map(e => e.path).join(", ")})`);
	} catch (error) { out.push(error.message); }
	try {
		const state = loadState(root, { migrate: !dryRun }).state;
		const armed = Object.entries(state.armed ?? {})
			.map(([id, channels]) => [id, keepProject ? (channels ?? []).filter(channel => channel === "project") : channels])
			.filter(([, channels]) => channels?.length && !(keepProject && channels.every(channel => channel === "project")));
		if (armed.length) out.push(`state still records armed channels: ${armed.map(([h, cs]) => `${h}=${cs.join("+")}`).join(", ")}`);
	} catch (error) { out.push(error.message); }
	return out;
}
