// The disk is the source of truth for armed state; `state.json` only caches it.
// Reconcile before reading: manually removed shims, incorrect old installs, and deleted slash files are corrected here.
// Previously the Web install channel setArmed(true) without checking install() errors, leaving false records.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadState, setArmed, resolveActivation } from "./state.mjs";

import { shimDir } from "./shim.mjs";

/** Return corrected entries such as ["pi:install"] for readable doctor/status output. */
export async function reconcileArmed(root) {
	const { status } = await import("./persist.mjs");
	const { resolveSlash } = await import("./slashes.mjs");
	const { state } = loadState(root);
	const armed = state.armed ?? {};
	const fixed = [];
	const installs = new Map(status(root).map((s) => [s.name, s.installed]));
	for (const [h, chans] of Object.entries(armed)) {
		for (const ch of [...chans]) {
			let alive = true;
			if (ch === "shim") {
				const bin = shimDir();
				alive = existsSync(join(bin, `${h}.cmd`)) || existsSync(join(bin, `${h}.ps1`)) || existsSync(join(bin, h));
			} else if (ch === "install") {
				alive = Boolean(installs.get(h)) || (resolveActivation(state, h, { launch: true }).mode === "off" && state.pausedInstalls?.includes(h));
			} else if (ch === "slash") {
				const s = resolveSlash(h, root);
				// DSH uses a probe for the mounted block instead of a fixed path; other slash channels use a single file.
				alive = Boolean(s && s.offered !== false && (s.probe ? s.probe() : existsSync(s.file)));
			}
			if (!alive) {
				setArmed(root, h, ch, false);
				fixed.push(`${h}:${ch}`);
			}
		}
	}
	return fixed;
}
