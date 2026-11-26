// Each explicit launch has independent credentials; inherited tokens, orphaned plugins, and other processes do not authorize activation.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { atomicControlJSON, withControlLock } from "./control.mjs";
import { loadState } from "./state.mjs";

/** Verification-only logic is also generated into plugins; bornAt is the host process start time at runtime. */
export function validLaunch(record, state, harness, identity) {
	if (!record || record.version !== 1 || record.harness !== harness || record.token !== identity.token) return false;
	if (!identity.token || record.hostPid !== identity.pid || !Number.isSafeInteger(record.hostPid)) return false;
	if (!Number.isFinite(identity.bornAt) || Math.abs(identity.bornAt - record.startedAt) > 10000) return false;
	if (!Number.isFinite(record.expiresAt) || record.expiresAt < identity.now || record.startedAt > identity.now + 1000) return false;
	if (record.epoch !== (state?.activationEpoch ?? "initial")) return false;
	if (record.harnessEpoch !== (state?.harnessEpochs?.[harness] ?? "initial")) return false;
	return true;
}

export function readLaunch(root, state, harness, token = process.env.AGENT_PURGE_LAUNCH) {
	if (!/^[a-f0-9-]{36}$/i.test(token ?? "")) return null;
	try {
		const record = JSON.parse(readFileSync(root + "/runtime/" + token + ".json", "utf8"));
		if (!validLaunch(record, state, harness, { token, pid: process.pid, bornAt: Date.now() - process.uptime() * 1000, now: Date.now() })) return null;
		try { process.kill(record.ownerPid, 0); } catch { return null; }
		return record;
	} catch { return null; }
}

/** Pass through the pre-publication callback; publication and deactivation share the configuration transaction lock. */
export function createLaunch(root, harness, { persona = null, mode, writer = "temporary" } = {}) {
	const token = randomUUID(), file = join(root, "runtime", token + ".json");
	const state = loadState(root).state;
	const initial = { epoch: state.activationEpoch ?? "initial", harnessEpoch: state.harnessEpochs?.[harness] ?? "initial" };
	let record = null, timer = null, closed = false;
	return {
		token, file, env: { AGENT_PURGE_LAUNCH: token },
		publish(hostPid, startedAt) {
			if (closed || !Number.isSafeInteger(hostPid)) throw new Error("Launch credential is missing the host PID");
			withControlLock(root, () => {
				const current = loadState(root).state;
				if ((current.activationEpoch ?? "initial") !== initial.epoch || (current.harnessEpochs?.[harness] ?? "initial") !== initial.harnessEpoch)
					throw new Error("Configuration was revoked during launch; restart");
				mkdirSync(join(root, "runtime"), { recursive: true });
				record = { version: 1, token, harness, ownerPid: process.pid, hostPid, startedAt, persona, mode, writer, ...initial, expiresAt: Date.now() + 60000 };
				atomicControlJSON(file, record);
			});
			timer = setInterval(() => {
				if (closed || !existsSync(file)) return;
				try { record.expiresAt = Date.now() + 60000; atomicControlJSON(file, record); } catch { /* Stop when credentials are lost instead of falling back to FORCE */ }
			}, 10000);
			timer.unref();
		},
		close() { if (timer) clearInterval(timer); closed = true; rmSync(file, { force: true }); },
	};
}

export const launchRuntime = [validLaunch, readLaunch].map(fn => fn.toString()).join("\n");
