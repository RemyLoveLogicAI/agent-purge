// Single configuration file; configured modes and runtime activation are resolved separately.
import { existsSync, readFileSync, renameSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { withControlLock, atomicControlJSON } from "./control.mjs";
import { resolveConfigured } from "./activation.mjs";
export { resolveActivation } from "./activation.mjs";

export const MODES = ["strict", "replace", "append", "off"];
export const ARMS = ["shim", "slash", "install", "project"];
export const ARM_LABEL = {
	shim: "Managed bare command (running codex uses the takeover)", slash: "In-session /purge (hot switch)",
	install: "Persistent configuration (also applies to externally launched processes)", project: "Rules files for selected projects",
};
export const statePath = root => join(root, "state.json");
const object = value => value && typeof value === "object" && !Array.isArray(value);
function emptyState() {
	return { v: 1, persona: null, default: null, armed: {}, overrides: {}, projectDirs: {}, piAuto: false, piUserLayer: false, ompAuto: false, dshProfiles: null };
}

/** Preserve corrupt configuration bytes and stop after reporting; runtime standalone read failures pass through. */
export function loadState(root, { migrate = true } = {}) {
	const file = statePath(root), migrated = [];
	let state = emptyState();
	if (existsSync(file)) {
		try {
			const raw = JSON.parse(readFileSync(file, "utf8"));
			if (!object(raw)) throw new Error("Configuration must be an object");
			state = { ...state, ...raw, armed: object(raw.armed) ? raw.armed : {},
				overrides: object(raw.overrides) ? raw.overrides : {}, projectDirs: object(raw.projectDirs) ? raw.projectDirs : {} };
		} catch (error) { throw new Error(`state.json is corrupt; original preserved: ${file}`, { cause: error }); }
	}
	const legacy = join(root, ".defaults.json");
	if (!state.default && existsSync(legacy)) {
		try {
			const d = JSON.parse(readFileSync(legacy, "utf8"));
			if (d?.harness) {
				state.default = { harness: d.harness, mode: MODES.includes(d.mode) ? d.mode : "replace" };
				migrated.push(`.defaults.json → default=${state.default.harness} · ${state.default.mode}`);
			}
		} catch { /* Preserve old configuration unchanged */ }
	}
	const oldActive = join(root, "personas", ".active");
	if (!state.persona && existsSync(oldActive)) {
		const id = readFileSync(oldActive, "utf8").trim();
		if (id) { state.persona = id; migrated.push(`personas/.active → persona=${id}`); }
	}
	if (migrate && migrated.length) withControlLock(root, () => {
		saveState(root, state);
		if (existsSync(legacy)) renameSync(legacy, legacy + ".migrated");
		if (existsSync(oldActive)) renameSync(oldActive, oldActive + ".migrated");
	});
	return { state, migrated };
}

export function saveState(root, state) {
	return withControlLock(root, () => {
		let before = {};
		try { before = JSON.parse(readFileSync(statePath(root), "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
		const next = { ...state };
		// A random revocation generation prevents off→on from reviving old launches; generated code checks it each turn.
		if (next.default?.mode === "off" && before.default?.mode !== "off") next.activationEpoch = randomUUID();
		const ids = new Set([...Object.keys(before.overrides ?? {}), ...Object.keys(next.overrides ?? {}), ...(next.disabledHarnesses ?? [])]);
		for (const id of ids) {
			if ((next.overrides?.[id]?.mode === "off" && before.overrides?.[id]?.mode !== "off") ||
				((next.disabledHarnesses ?? []).includes(id) && !(before.disabledHarnesses ?? []).includes(id)))
				next.harnessEpochs = { ...next.harnessEpochs, [id]: randomUUID() };
		}
		atomicControlJSON(statePath(root), next);
		return next;
	});
}
export function updateState(root, update) {
	return withControlLock(root, () => saveState(root, update(loadState(root).state)));
}
export function patchState(root, patch) { return updateState(root, state => ({ ...state, ...patch })); }
export function setDefault(root, { harness, mode }) {
	if (!harness) throw new Error("Harness is empty");
	if (!MODES.includes(mode)) throw new Error(`Unknown mode: ${mode}`);
	return updateState(root, state => ({ ...state, default: { harness, mode } })).default;
}
export function setPersona(root, id) { return patchState(root, { persona: id }).persona; }
export function setPiAuto(root, on) { return patchState(root, { piAuto: on === true }).piAuto; }
export function setOmpAuto(root, on) { return patchState(root, { ompAuto: on === true }).ompAuto; }
export function setPiUserLayer(root, on) { return patchState(root, { piUserLayer: on === true }).piUserLayer; }
export function armedOf(state, id) { return Array.isArray(state?.armed?.[id]) ? state.armed[id] : []; }
export function setArmed(root, id, arm, on) {
	if (!ARMS.includes(arm)) throw new Error(`Unknown channel: ${arm}`);
	const state = updateState(root, before => {
		const cur = new Set(armedOf(before, id)); on ? cur.add(arm) : cur.delete(arm);
		const list = ARMS.filter(a => cur.has(a)), armed = { ...before.armed };
		if (list.length) armed[id] = list; else delete armed[id];
		return { ...before, armed };
	});
	return armedOf(state, id);
}
export function overridesOf(state) { return object(state?.overrides) ? state.overrides : {}; }
export function resolveFor(state, id) { return resolveConfigured(state, id); }
export function setOverride(root, id, patch = {}) {
	const next = updateState(root, state => {
		const cur = { ...(overridesOf(state)[id] ?? {}) };
		for (const [key, value] of Object.entries(patch)) {
			if (!["persona", "mode"].includes(key)) throw new Error(`Unknown per-harness field: ${key}`);
			if (value === null || value === undefined || value === "") delete cur[key];
			else if (key === "mode" && !MODES.includes(value)) throw new Error(`Unknown mode: ${value}`);
			else cur[key] = value;
		}
		const overrides = { ...overridesOf(state) };
		if (Object.keys(cur).length) overrides[id] = cur; else delete overrides[id];
		return { ...state, overrides };
	});
	return next.overrides[id] ?? null;
}
export function dshProfilesOf(state) { return Array.isArray(state?.dshProfiles) ? state.dshProfiles : null; }
export function setDshProfile(root, profile, on, all) {
	if (!all.includes(profile)) throw new Error(`Unknown dsh profile: ${profile}`);
	return updateState(root, state => {
		const cur = new Set(dshProfilesOf(state) ?? all); on ? cur.add(profile) : cur.delete(profile);
		return { ...state, dshProfiles: all.filter(p => cur.has(p)) };
	}).dshProfiles;
}
