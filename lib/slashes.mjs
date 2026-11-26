// In-session `/purge`: install the current persona, then use `/purge` in the session to switch.
//
// Important distinction: **slash commands are not equivalent to system-prompt injection**.
//   pi / omp  —— extension rewrites systemPrompt at before_agent_start → system layer, hot switching (100% in observed tests)
//   claude    —— ~/.claude/commands/purge.md expands as a **user message** → user layer
//   codex     —— ~/.codex/prompts/purge.md same → user layer
//   opencode  —— ~/.config/opencode/command/purge.md same → user layer (system layer requires the persistent plugin)
// User-layer injection success rates are recorded in matrix.json under armor.probe.*.user and displayed by `agent-purge ls`.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { configHome } from "./paths.mjs";
import { extensionSource } from "./extension.mjs";
import { installPlugin, probePlugin, pluginDir, uninstallPlugin } from "./pi-desktop.mjs";
import { SLASH_RESIDENT, addPlugin, hasPluginAny, pluginFileOnDisk, removePlugin, slashSource } from "./dsh.mjs";
import { record } from "./footprints.mjs";
import { readStash, removeOwnedFile, writeStash, looksOwned, preserveEdited, unusedBackup } from "./persist.mjs";
import { cancel, forgetHarness } from "./footprints.mjs";

const SIDECAR = ".disabled-by-agent-purge";

/** Which harnesses have /purge, their layer, and file location */
export function resolveSlash(id, root) {
	const homeOf = configHome;
	const specs = {
		"pi-desktop": () => ({
			layer: "sys",
			offered: true,
			hot: true,
			trigger: "/purge on|off|status|mode",
			file: join(pluginDir(), "src", "agent-purge.ts"),
			render: () => extensionSource(root, "pi"),
			probe: probePlugin,
			note: "An imported plugin contributes ExtensionAPI: before_agent_start rewrites systemPrompt each turn, so /purge and persona changes need no restart (the initial installation requires one PI-Desktop restart)",
		}),
		pi: () => {
			const base = homeOf("pi");
			if (!base) return null;
			return {
				layer: "sys",
				offered: true,
				hot: true,
				trigger: "/purge on|off|status|mode",
				file: join(base, "extensions", "agent-purge.ts"),
				render: () => extensionSource(root, "pi"),
				note: "The extension rewrites systemPrompt at before_agent_start in the actual system-prompt layer, follows persona changes in state.json, and needs no reinstall",
			};
		},
		claude: () => {
			const base = homeOf("claude");
			if (!base) return null;
			return {
				layer: "user",
				offered: false,
				hot: false,
				trigger: "/purge",
				file: join(base, "commands", "purge.md"),
				render: ({ personaBody, personaId }) => commandMd("Switch this session’s rules to the current agent-purge persona", personaBody, personaId),
				note: "Claude slash commands expand into user messages → user layer (bench observed 0/2 effective); use agent-purge claude (--system-prompt-file) for the persona",
			};
		},
		codex: () => {
			const base = homeOf("codex");
			if (!base) return null;
			return {
				layer: "user",
				offered: false,
				hot: false,
				trigger: "/purge",
				file: join(base, "prompts", "purge.md"),
				render: ({ personaBody, personaId }) => `${personaBody.trim()}\n\n<!-- agent-purge: ${personaId} -->\n`,
				note: "Codex custom prompts are user messages → user layer (bench observed 0/2 effective); Codex uses model_instructions_file read at startup",
			};
		},
		opencode: () => {
			const base = homeOf("opencode");
			if (!base) return null;
			return {
				layer: "user",
				offered: false,
				hot: false,
				trigger: "/purge",
				file: join(base, "command", "purge.md"),
				render: ({ personaBody, personaId }) => commandMd("Load the current agent-purge persona", personaBody, personaId),
				note: "OpenCode commands are user messages → user layer (bench observed 0/2 effective); use install (chat.system.transform plugin) for the system layer",
			};
		},
		omp: () => {
			const base = homeOf("omp");
			if (!base) return null;
			return {
				layer: "sys",
				offered: true,
				hot: true,
				trigger: "/purge on|off|status|mode",
				file: join(base, "agent", "extensions", "agent-purge.ts"),
				render: () => extensionSource(root, "omp"),
				note: "The extension rewrites the systemPrompt array at before_agent_start in the actual system layer; /purge hot-switches for the next turn",
			};
		},
		// dsh: instead of writing a file, install a small Cordis plugin (agent-purge-slash) in each of three profiles.
		// It only registers /purge and changes state.json, not the system prompt; injection belongs to the persistent agent-purge plugin.
		dsh: () => ({
			layer: "sys",
			offered: true,
			hot: true,
			trigger: "/purge on|off|status|mode",
			file: pluginFileOnDisk(SLASH_RESIDENT),
			// Check the mounted block and file, not a fixed profile path (desktop may never have been created); any present copy counts as usable.
			probe: () => hasPluginAny(SLASH_RESIDENT),
			render: () => slashSource(root),
			note: "The Cordis plugin registers /purge (/ap is an alias): changes state.json and takes effect next turn without a model message; injection requires the persistent plugin, so enable both",
		}),
	};
	const spec = specs[id];
	if (!spec) return null;
	const base = spec();
	if (!base) return null;
	return { id, ...base };
}

export function installSlash(id, root, { personaId, personaBody } = {}) {
	const s = resolveSlash(id, root);
	if (!s) return { error: `${id} has no /purge channel` };
	if (s.offered === false) return { error: `${s.note}(retired; no longer offered)` };
	// dsh: install the Cordis plugin in three profiles; there is no single file to write.
	// addPlugin throws if dsh has never run; convert it to {error} here or arm --all crashes midway.
	if (id === "pi-desktop") {
		const r = installPlugin(root);
		if (r.error) return { error: r.error };
		return { file: r.file, layer: s.layer, note: r.note };
	}
	if (id === "dsh") {
		try {
			const r = addPlugin(SLASH_RESIDENT, slashSource(root));
			return { file: pluginFileOnDisk(SLASH_RESIDENT), layer: s.layer, note: s.note, sidecars: [], profiles: r.profiles };
		} catch (e) {
			return { error: e.message };
		}
	}
	mkdirSync(dirname(s.file), { recursive: true });

	// pi: the old pi-purge.ts also registers /purge and conflicts; move it aside first and restore it on uninstall.
	const sidecars = [];
	if (id === "pi") {
		const legacy = join(dirname(s.file), "pi-purge.ts");
		if (existsSync(legacy)) {
			const off = unusedBackup(legacy);
			renameSync(legacy, off);
			sidecars.push({ from: off, to: legacy });
		}
	}

	// The extension file replaces a same-named user file in full: save original bytes before writing so uninstall can restore them.
	const old = existsSync(s.file) ? readFileSync(s.file, "utf8") : null;
	const content = s.render({ personaId, personaBody });
	const previous = readStash(s.file, root);
	if (previous && old !== previous.after && looksOwned(old)) preserveEdited(s.file, old);
	writeStash(s.file, { file: s.file, before: previous ? previous.before : looksOwned(old) ? null : old, after: content }, root);
	writeFileSync(s.file, content, "utf8");
	record(root, {
		kind: "file",
		harness: id,
		channel: "slash",
		path: s.file,
		undo: { type: "file-delete" },
		createdByUs: old === null,
	});
	return { file: s.file, layer: s.layer, note: s.note, sidecars, replaced: old !== null };
}

export function uninstallSlash(id, root) {
	const s = resolveSlash(id, root);
	if (!s) return { error: `${id} has no /purge channel` };
	if (id === "pi-desktop") {
		const r = uninstallPlugin();
		forgetHarness(root, id, "slash");
		return { removed: r.removed.length ? r.removed : [s.file] };
	}
	if (id === "dsh") {
		const result = removePlugin(SLASH_RESIDENT);
		forgetHarness(root, id, "slash");
		return { removed: [s.file], ...result };
	}
	const removed = [];
	const notes = [];
	if (existsSync(s.file)) {
		const r = removeOwnedFile(s.file, { root });
		if (r.action === "skipped-foreign") {
			// Not written by us: do not delete. Keep the ledger entry so clean reports it in leftovers.
			notes.push(`${s.file} was not written by agent-purge and was not deleted (remove it manually to remove /purge)`);
		} else if (r.action === "restored-file") {
			removed.push(s.file);
			notes.push(`${s.file} was restored to its pre-install contents`);
		} else if (r.action === "disabled-edited-file") {
			removed.push(s.file);
			notes.push(`${s.file} was modified and renamed to ${r.moved} to disable it (original bytes preserved)`);
		} else if (r.action !== "already-gone") {
			removed.push(s.file);
		}
	}
	if (id === "pi") {
		const legacy = join(dirname(s.file), "pi-purge.ts");
		if (!existsSync(legacy) && existsSync(legacy + SIDECAR)) {
			renameSync(legacy + SIDECAR, legacy);
			removed.push(`${legacy}(original pi-purge extension restored)`);
		}
	}
	if (!existsSync(s.file)) cancel(root, { kind: "file", path: s.file });
	return { removed, ...(notes.length ? { notes } : {}) };
}

export function slashStatus(root) {
	const out = [];
	for (const id of Object.keys({ pi: 1, "pi-desktop": 1, omp: 1, claude: 1, codex: 1, opencode: 1, dsh: 1 })) {
		const s = resolveSlash(id, root);
		if (!s) continue;
		const installed = s.probe ? s.probe() : existsSync(s.file);
		let personaId = null;
		if (installed && existsSync(s.file)) {
			const text = readFileSync(s.file, "utf8");
			personaId = (text.match(/agent-purge: ([a-z0-9_-]+)/i) || [])[1] ?? (id === "pi" || id === "omp" ? "(follows state.json)" : null);
		}
		out.push({ id, layer: s.layer, offered: s.offered !== false, hot: s.hot, file: s.file, installed, personaId, trigger: s.trigger, note: s.note });
	}
	return out;
}

/** Re-render installed user-layer command files after a persona switch (their contents are baked in and must be refreshed) */
export function refreshSlashes(root, armedIds, { personaId, personaBody }) {
	const updated = [];
	for (const id of armedIds) {
		const s = resolveSlash(id, root);
		if (!s?.hot && s && s.offered !== false && existsSync(s.file)) {
			const old = readFileSync(s.file, "utf8");
			const content = s.render({ personaId, personaBody });
			// Refresh changes only after; retain the previous before value or uninstall restores the prior persona instead of the user’s original text.
			const prev = readStash(s.file, root);
			writeStash(s.file, { file: s.file, before: prev ? prev.before : old, after: content }, root);
			writeFileSync(s.file, content, "utf8");
			updated.push(s.file);
		}
	}
	return updated;
}

function commandMd(description, body, personaId) {
	return `---\ndescription: ${description}\n---\n\n${body.trim()}\n\n<!-- agent-purge: ${personaId} -->\n`;
}
