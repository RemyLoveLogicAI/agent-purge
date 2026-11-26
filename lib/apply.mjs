// Single application entry point for CLI and Web. Written configuration does not mean a running harness has read it.
import { createHash, randomUUID } from "node:crypto";
import { withControlLock } from "./control.mjs";
import { join } from "node:path";
import { createStore } from "./personas.mjs";
import { ARMS, MODES, loadState, patchState, resolveFor, resolveActivation, setArmed, setOverride } from "./state.mjs";
import { install, uninstall, status as installStatus } from "./persist.mjs";
import { installSlash, uninstallSlash } from "./slashes.mjs";
import { installShim, uninstallShim } from "./shim.mjs";
import { projectDirectories, projectFilePath, projectInstall, projectUninstall } from "./project.mjs";
import { liveProfiles } from "./dsh.mjs";
import { capsFor } from "./caps.mjs";
import { verifiedHarnesses } from "./verification.mjs";
import { readResource } from "./root.mjs";
const HARNESS_IDS = (() => {
	try { return new Set(Object.keys(JSON.parse(readResource("matrix.json").toString("utf8")).harnesses)); }
	catch (error) { throw new Error(`Failed to read harness manifest: ${error.message}`, { cause: error }); }
})();

const DYNAMIC = new Set(["dsh", "opencode", "opencode2"]);

const exclusive = withControlLock;

export function effectFor(harness, channel, mode) {
	if (channel === "shim") return { when: "next-launch", message: "Takes effect for newly launched commands; running sessions are unchanged" };
	if (channel === "slash") return { when: "next-turn", message: "Loaded extensions read it on the next turn; initial installation requires restart, and manual channels require /purge on" };
	if (channel === "project") return { when: "next-session", message: "Selected project rules files processed; new sessions in those directories read them" };
	if (DYNAMIC.has(harness)) return { when: "next-turn", message: "Loaded plugins read it on the next turn; first installation or plugin code updates require restart" };
	return { when: "next-session", message: mode === "off" ? "Static content removed; running sessions need restarting" : "Configuration written; new sessions read it" };
}

function attempt(harness, channel, mode, work) {
	try {
		const result = work() ?? {};
		if (result.error) throw new Error(result.error);
		return { harness, channel, status: "written", runtimeConfirmed: false, ...effectFor(harness, channel, mode), ...result };
	} catch (e) {
		return { harness, channel, status: "failed", runtimeConfirmed: false, error: e.message };
	}
}

function sync(root, options = {}) {
	const store = createStore(root);
	const { state: before } = loadState(root);
	if (options.mode !== undefined && !MODES.includes(options.mode)) throw new Error(`Unknown mode: ${options.mode}`);
	const persona = options.persona ?? store.activeId();
	let mode = options.mode ?? before.default?.mode ?? "replace";
	if (options.enabled === false) mode = "off";
	if (before.default?.mode === "off" && options.enabled !== true && mode !== "off") mode = "off";
	if (options.enabled === true && mode === "off") mode = MODES.includes(before.prevMode) && before.prevMode !== "off" ? before.prevMode : "replace";
	const picked = store.read(persona);
	if (!picked && mode !== "off") throw new Error("No persona available; cannot apply");
	if (options.persona !== undefined && !picked) throw new Error(`No persona: ${options.persona}`);
	if (options.resumeMode !== undefined && !["strict", "replace", "append"].includes(options.resumeMode)) throw new Error(`Unknown resume mode: ${options.resumeMode}`);
	const prevMode = options.resumeMode ?? (mode === "off" && options.mode && options.mode !== "off" ? options.mode : null) ?? (mode === "off" && before.default?.mode !== "off" ? before.default?.mode ?? "replace" : before.prevMode);
	// Publish off first so dynamic channels still stop if any static cleanup fails.
	patchState(root, { default: { harness: options.harness !== undefined ? options.harness : before.default?.harness ?? null, mode }, prevMode });
	if (picked) store.setActive(picked.id);
	const active = join(root, "personas", "active.md");
	const revision = createHash("sha256").update(JSON.stringify([picked?.id ?? null, picked?.body.trim() ?? "", mode])).digest("hex").slice(0, 16);
	const paused = new Set(before.pausedInstalls ?? []);
	const selected = before.armed ?? {};
	// Effective values per host = global defaults plus host overrides (stored in state.json.overrides and read by runtime plugins).
	const view = {
		...before,
		persona: picked?.id ?? before.persona,
		default: { harness: options.harness !== undefined ? options.harness : before.default?.harness ?? null, mode },
	};
	const forHarness = (harness) => {
		const eff = resolveFor(view, harness);
		const who = store.read(eff.persona) ?? (eff.personaFrom === "override" ? null : picked);
		return {
			persona: who ?? null,
			active: who && picked && who.id !== picked.id ? store.materialize(who.id) : active,
			// Pause is the master switch: global off overrides all exceptions.
			mode: resolveActivation(view, harness, { launch: true }).mode,
		};
	};
	const failures = options.onlyFailed ? (before.lastApply?.results ?? []).filter(r => r.status === "failed") : null;
	const retry = failures ? new Set(failures.map(r => `${r.harness}:${r.channel}`)) : null;
	const results = [];
	for (const [harness, channels] of Object.entries(selected)) {
		if (!Array.isArray(channels)) continue;
		for (const channel of channels) {
			if (retry && !retry.has(`${harness}:${channel}`)) continue;
			const h = forHarness(harness);
			if (channel === "project") {
				const dirs = projectDirectories(root, harness);
				if (!dirs.length) {
					results.push({ ...attempt(harness, channel, h.mode, () => ({ error: "No project directory registered; re-enable the project channel and specify a directory" })), persona: h.persona?.id ?? null, mode: h.mode });
				}
				for (const dir of dirs) {
					const file = projectFilePath(harness, dir);
					if (failures && !failures.some(r => r.harness === harness && r.channel === channel && (!r.file || r.file === file))) continue;
					const r = attempt(harness, channel, h.mode, () => h.mode === "off"
						? projectUninstall(harness, { root, dir, keepSelection: true })
						: projectInstall(harness, { root, dir, active: String(h.persona?.body ?? "").trim() }));
					results.push({ file, ...r, persona: h.persona?.id ?? null, mode: h.mode });
				}
				continue;
			}
			const r = attempt(harness, channel, h.mode, () => {
				if (channel === "install") {
					if (h.mode === "off" && !DYNAMIC.has(harness)) {
						const r = uninstall(harness, { root });
						if (!r.error) paused.add(harness);
						return r;
					}
					if (h.mode === "off") return { action: "disabled-by-state" };
					const r = install(harness, { root, active: h.active, mode: h.mode });
					if (!r.error) paused.delete(harness);
					return r;
				}
				if (channel === "slash") {
					if (h.mode === "off") return { action: "disabled-by-state" };
					return installSlash(harness, root, { personaId: h.persona?.id, personaBody: String(h.persona?.body ?? "").trim() });
				}

				if (channel === "shim") return { action: "reads-on-launch" };
				return { error: `Unknown channel: ${channel}` };
			});
			results.push({ ...r, persona: h.persona?.id ?? null, mode: h.mode });
		}
	}
	// Older versions may have written static files without recording armed. Off also cleans identified managed blocks without expanding restoration scope.
	if (mode === "off" && !retry) {
		for (const row of installStatus(root)) {
			if (!row.installed || DYNAMIC.has(row.name) || selected[row.name]?.includes("install")) continue;
			results.push(attempt(row.name, "install", mode, () => uninstall(row.name, { root })));
		}
	}
	// runtimeConfirmed is not a hard-coded constant: confirmation requires local capture evidence that the persona entered a privileged layer.
	const verified = verifiedHarnesses(root);
	for (const r of results) { r.historicalCapabilityVerified = verified.has(r.harness); r.runtimeConfirmed = false; }
	const failed = results.filter(r => r.status === "failed");
	const report = { id: randomUUID(), at: new Date().toISOString(), revision, persona: picked?.id ?? null, mode,
		ok: failed.length === 0, partial: failed.length > 0 && results.some(r => r.status !== "failed"), results,
		runtimeConfirmed: results.some(r => r.runtimeConfirmed) };
	patchState(root, { pausedInstalls: [...paused].filter(h => selected[h]?.includes("install")), lastApply: report });
	return report;
}

export function applyConfiguration(root, options = {}) {
	return exclusive(root, () => sync(root, options));
}

/** Separate install scope from power: adding a static channel while paused only records the selection without writing a persona; uninstall does not require a persona. */
export function changeChannel(root, { harness, channel, enabled, force = false, dir, expectSha }) {
	return exclusive(root, () => {
		if (!ARMS.includes(channel)) throw new Error(`Unknown channel: ${channel}`);
		if (!HARNESS_IDS.has(harness)) throw new Error(`Unknown harness: ${harness}`);
		if (typeof enabled !== "boolean") throw new Error("enabled must be a boolean");
		const { state } = loadState(root);
		// Channel paths use the same resolution: write the host-specific persona and mode when overridden.
		const eff = resolveFor(state, harness);
		const mode = resolveActivation(enabled ? { ...state, disabledHarnesses: (state.disabledHarnesses ?? []).filter(id => id !== harness) } : state, harness, { launch: true }).mode;
		if (!enabled && !(state.armed?.[harness] ?? []).some(c => c !== channel)
			&& !(channel === "project" && dir !== undefined && projectDirectories(root, harness).length > 1)) {
			patchState(root, { disabledHarnesses: [...new Set([...(state.disabledHarnesses ?? []), harness])] });
		}
		// Undo without a directory disables the entire harness or cleans; with a directory it undoes only that location.
		if (channel === "project" && !enabled && dir === undefined) {
			const results = projectDirectories(root, harness).map(dir => ({
				file: projectFilePath(harness, dir),
				...attempt(harness, channel, mode, () => projectUninstall(harness, { root, dir })),
			}));
			setArmed(root, harness, channel, projectDirectories(root, harness).length > 0);
			const failed = results.filter(r => r.status === "failed");
			return { harness, channel, ...effectFor(harness, channel, mode), ok: !failed.length,
				status: failed.length ? "failed" : "written", runtimeConfirmed: false, results,
				...(failed.length ? { error: failed.map(r => `${r.file}: ${r.error}`).join("；") } : {}),
			};
		}
		// dsh slash depends on the persistent install plugin to rewrite system prompts: enabling slash automatically installs it if absent.
		if (harness === "dsh" && channel === "slash" && enabled && !(state.armed?.dsh ?? []).includes("install")) {
			const store = createStore(root);
			const picked = store.read(eff.persona) ?? (eff.personaFrom === "override" ? null : store.read(store.activeId()));
			if (picked) {
				const activePath = store.activeId() && picked.id !== store.activeId() ? store.materialize(picked.id) : store.refreshActive();
				const installResult = attempt(harness, "install", mode, () => install(harness, { root, active: activePath, mode }));
				if (installResult.status === "failed") {
					return { ok: false, ...installResult, error: `Cascaded persistent configuration installation failed: ${installResult.error}` };
				}
				setArmed(root, harness, "install", true);
			}
		}
		// When uninstalling persistent dsh configuration, also remove the session-command plugin if present to avoid leaving an ineffective orphan.
		if (harness === "dsh" && channel === "install" && !enabled && (state.armed?.dsh ?? []).includes("slash")) {
			attempt(harness, "slash", mode, () => uninstallSlash(harness, root));
			setArmed(root, harness, "slash", false);
		}
		const result = attempt(harness, channel, mode, () => {
			if (enabled && !force) {
				const cap = capsFor(harness)[channel];
				if (!cap?.ok) return { error: cap?.why ?? "Channel not supported" };
			}
			if (!enabled) {
				if (channel === "install") return uninstall(harness, { root });
				if (channel === "slash") return uninstallSlash(harness, root);
				if (channel === "project") return projectUninstall(harness, { dir, root, expectSha });
				return uninstallShim(root, harness);
			}
			if (channel === "shim") return installShim(root, harness);
			if (channel === "install" && mode === "off" && !DYNAMIC.has(harness)) return { action: "selected-while-paused" };
			if (channel === "project" && mode === "off") return projectInstall(harness, { root, dir, paused: true });
			const store = createStore(root);
			const picked = store.read(eff.persona) ?? (eff.personaFrom === "override" ? null : store.read(store.activeId()));
			if (!picked) return { error: "No persona available" };
			const activePath = store.activeId() && picked.id !== store.activeId() ? store.materialize(picked.id) : store.refreshActive();
			if (channel === "install") return install(harness, { root, active: activePath, mode });
			if (channel === "project") return projectInstall(harness, { root, active: picked.body.trim(), dir, expectSha });
			return installSlash(harness, root, { personaId: picked.id, personaBody: picked.body.trim() });
		});
		if (result.status !== "failed") {
			if (enabled) patchState(root, { disabledHarnesses: (loadState(root).state.disabledHarnesses ?? []).filter(id => id !== harness) });
			setArmed(root, harness, channel, channel === "project" ? projectDirectories(root, harness).length > 0 : enabled);
			// When enabling the dsh hot-switch channel, initialize purge off by default; prompts are injected only after /purge on in the session.
			if (harness === "dsh" && channel === "slash" && enabled) {
				const prevRuntime = loadState(root).state.dshRuntime ?? {};
				const nextRuntime = { ...prevRuntime };
				const targets = liveProfiles();
				const profiles = targets.length ? targets : ["desktop", "web", "headless", "sdk"];
				for (const p of profiles) {
					nextRuntime[p] = { ...(prevRuntime[p] ?? {}), enabled: false };
				}
				patchState(root, { dshRuntime: nextRuntime });
			}
			const paused = new Set(state.pausedInstalls ?? []);
			if (channel === "install") {
				if (enabled && result.action === "selected-while-paused") paused.add(harness);
				else paused.delete(harness);
				patchState(root, { pausedInstalls: [...paused] });
			}
		}
		return { ok: result.status !== "failed", ...result };
	});
}

/** Apply per-host changes and synchronize all relevant locations in one transaction. */
export function configureHarness(root, harness, patch) {
	return exclusive(root, () => {
		if (!HARNESS_IDS.has(harness)) throw new Error(`Unknown harness: ${harness}`);
		if (patch.persona && !createStore(root).read(patch.persona)) throw new Error(`No persona: ${patch.persona}`);
		setOverride(root, harness, patch);
		return { effective: resolveFor(loadState(root).state, harness), ...sync(root) };
	});
}

export function disableHarness(root, harness) {
	return exclusive(root, () => {
		if (!HARNESS_IDS.has(harness)) throw new Error(`Unknown harness: ${harness}`);
		const state = loadState(root).state;
		patchState(root, { disabledHarnesses: [...new Set([...(state.disabledHarnesses ?? []), harness])] });
		// State may have been lost (old versions or manual deletion) while configuration files still contain our blocks.
		// When disabling, use disk probes to include install and avoid leaving a persona behind a disabled button.
		const channels = new Set(state.armed?.[harness] ?? []);
		try {
			const actual = installStatus(root).find(item => item.name === harness);
			if (actual?.installed) channels.add("install");
		} catch { /* Probe failure must not block cleanup of known channels */ }
		const results = [...channels].map(channel => changeChannel(root, { harness, channel, enabled: false }));
		return { ok: results.every(r => r.ok), results };
	});
}
