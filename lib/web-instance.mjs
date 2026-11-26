// Console singleton registry: only one console instance per data directory.
//
// The singleton includes the console service and its desktop window. Its registry is in the data directory,
// so relaunching in the same home (double-clicking the exe or running web again) brings the existing window forward
// without starting another service or page. A different AGENT_PURGE_HOME has an independent instance.
//
// Liveness checks the registered PID only. A forced termination leaves the file; the next launch removes it if the PID is gone.
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "web-instance.json";

export function instancePath(home) {
	return join(home, FILE);
}

/** Read the registry; treat corrupt files as absent without throwing. */
export function readInstance(home) {
	try {
		const record = JSON.parse(readFileSync(instancePath(home), "utf8"));
		if (!record || typeof record !== "object") return null;
		if (!Number.isInteger(record.pid) || !Number.isInteger(record.port)) return null;
		return record;
	} catch {
		return null;
	}
}

/** Check PID liveness; EPERM means the process exists even though signaling is denied. */
export function processAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/**
 * Atomic claim: only a process that creates the registry exclusively acquires the instance.
 * @returns {{ ok: true } | { ok: false, existing?: object, error?: Error }}
 */
export function claimInstance(home, record) {
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = openSync(instancePath(home), "wx");
			try {
				writeFileSync(handle, `${JSON.stringify({ ...record, startedAt: new Date().toISOString() }, null, 2)}\n`);
			} finally {
				closeSync(handle);
			}
			return { ok: true };
		} catch (error) {
			if (error.code !== "EEXIST") return { ok: false, error };
			const existing = readInstance(home);
			// A repeated claim by the same process is not a conflict, as when restarting the server.
			if (existing && existing.pid !== process.pid && processAlive(existing.pid)) return { ok: false, existing };
			// Stale registry: process is gone, so remove it and retry.
			try { rmSync(instancePath(home), { force: true }); } catch {}
		}
	}
	return { ok: false, existing: readInstance(home) ?? undefined };
}

/**
 * Claim and register exit cleanup for reuse by all launch entry points.
 * Port 0 requests a random port for isolated smoke tests and does not participate in the singleton.
 * @returns {{ ok: true } | { ok: false, existing?: object, error?: Error }}
 */
export function registerInstance(home, port) {
	if (port === 0) return { ok: true };
	const claim = claimInstance(home, { pid: process.pid, port });
	if (claim.ok) process.once("exit", () => releaseInstance(home, process.pid));
	return claim;
}

/** Record the window process for future foregrounding; update only our own registry entry. */
export function updateWindow(home, pid, windowPid) {
	const existing = readInstance(home);
	if (!existing || existing.pid !== pid) return false;
	writeFileSync(instancePath(home), `${JSON.stringify({ ...existing, windowPid }, null, 2)}\n`);
	return true;
}

/** Clean up on exit; if the PID differs, ownership changed and the entry must not be deleted. */
export function releaseInstance(home, pid = process.pid) {
	const existing = readInstance(home);
	if (!existing || existing.pid !== pid) return false;
	rmSync(instancePath(home), { force: true });
	return true;
}

/**
 * Check whether the console window process is alive.
 * autoExit uses window liveness instead of page heartbeats to decide whether to stop the service:
 * stopping while the window is alive leaves an unreachable old page and creates another on the next launch (issue #14).
 */
export function windowAliveIn(home, port = null) {
	const record = readInstance(home);
	if (!record || record.pid !== process.pid) return false;
	if (Number.isInteger(port) && record.port !== port) return false;
	if (!Number.isInteger(record.windowPid) || record.windowPid <= 0) return false;
	return processAlive(record.windowPid);
}
