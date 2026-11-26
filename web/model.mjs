import { getLocale, listJoin } from './i18n.mjs';

const MODE_LABELS_BY_LOCALE = {
	en: { strict: 'Persona Only', replace: 'Replace Identity', append: 'Append', off: 'Paused' },
};
const MODE_DESCRIPTIONS_BY_LOCALE = {
	en: {
		replace: 'Keeps built-in coding rules and tool definitions; replaces only the assistant identity. Recommended for most tools.',
		strict: 'Suppresses controllable built-in system instructions so the persona takes priority. Scope varies by tool.',
		append: 'Keeps the built-in system prompt intact and appends the persona at the end. Required for append-only tools.',
		off: 'Pauses persona injection for this tool while keeping local configuration.',
	},

};

export const modeLabels = (locale = getLocale()) => MODE_LABELS_BY_LOCALE.en;
export const modeDescriptions = (locale = getLocale()) => MODE_DESCRIPTIONS_BY_LOCALE.en;

// Legacy exports kept for existing imports; prefer modeLabels()/modeDescriptions() for dynamic locale.
export const MODE_LABELS = new Proxy({}, {
	get: (_, key) => modeLabels()[key],
	ownKeys: () => Object.keys(MODE_LABELS_BY_LOCALE.en),
	getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: modeLabels()[key] }),
});
export const MODE_DESCRIPTIONS = new Proxy({}, {
	get: (_, key) => modeDescriptions()[key],
	ownKeys: () => Object.keys(MODE_DESCRIPTIONS_BY_LOCALE.en),
	getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: modeDescriptions()[key] }),
});

const PURGE_NOTES_BY_LOCALE = {
	en: {
		append: 'This tool has no full system-prompt entry: the persona is appended, so built-in identity remains.',
		partial: 'Replacement is active, though part of the host prompt survives (its own identity line, or fixed clauses it re-prepends).',
		unverified: 'System prompt character count has not been measured for this tool yet; no purge claim is made.',
	},

};

export const purgeNoteOf = (harness, locale = getLocale()) => {
	const table = PURGE_NOTES_BY_LOCALE.en;
	return table[harness?.purgeKind] ?? null;
};

export function modeAvailability(harness, locale = getLocale()) {
	const labels = modeLabels(locale);
	const declared = Array.isArray(harness?.modes) && harness.modes.length ? harness.modes : null;
	const supported = declared ? new Set([...declared, 'off']) : new Set(Object.keys(labels));
	return {
		supported,
		limited: Boolean(declared),
		preferred: harness?.preferredMode ?? null,
		note: harness?.modesNote ?? (declared
			? `Supports only: ${declared.map(m => labels[m] || m).join(' / ')}`
			: null),
		purgeKind: harness?.purgeKind ?? 'replace',
		purgeNote: purgeNoteOf(harness, locale),
	};
}

export const unsupportedHarnesses = (list, mode) => (list || []).filter(h => !modeAvailability(h).supported.has(mode));

const CAPTURE_LABELS_BY_LOCALE = {
	en: {
		captured: 'Captured', passed: 'Passed', partial: 'Partial', blocked: 'Blocked',
		missing: 'Not found', unavailable: 'Not found', error: 'Error', mismatch: 'Mismatch',
		'no-request': 'No request', 'not-tested': 'Not tested',
	},

};
export const captureLabels = (locale = getLocale()) => CAPTURE_LABELS_BY_LOCALE.en;
export const CAPTURE_LABELS = new Proxy({}, {
	get: (_, key) => captureLabels()[key],
	ownKeys: () => Object.keys(CAPTURE_LABELS_BY_LOCALE.en),
	getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: captureLabels()[key] }),
});

const CHANNEL_LABELS_BY_LOCALE = {
	en: { install: 'Config', shim: 'CLI Shim', slash: 'Plugin', project: 'Project Rules' },
};
export const channelLabels = (locale = getLocale()) => CHANNEL_LABELS_BY_LOCALE.en;
export const CHANNEL_LABELS = new Proxy({}, {
	get: (_, key) => channelLabels()[key],
	ownKeys: () => Object.keys(CHANNEL_LABELS_BY_LOCALE.en),
	getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: channelLabels()[key] }),
});

export const HARNESS_TITLES = {
	'workbuddy-ai': 'WorkBuddy AI',
	'workbuddy': 'WorkBuddy',
	'pi-desktop': 'PI-Desktop',
	'opencode2': 'OpenCode 2.x',
	'codebuddy': 'CodeBuddy',
	'claude': 'Claude Code',
	'antigravity': 'Antigravity',
	'codex': 'Codex',
	'grok': 'Grok',
	'kilo': 'Kilo Code',
	'hermes': 'Hermes',
	'opencode': 'OpenCode',
	'pi': 'Pi',
	'dsh': 'dsh',
	'omp': 'omp',
	'zcode': 'ZCode',
	cursor: 'Cursor',
	devin: 'Devin CLI',
	copilot: 'GitHub Copilot CLI',
	amp: 'Amp',
	cline: 'Cline',
	roo: 'Roo Code',
	crush: 'Crush',
	continue: 'Continue CLI',
	qoder: 'Qoder CLI',
	kimi: 'Kimi Code',
	auggie: 'Auggie CLI',
	goose: 'Goose',
	qwen: 'Qwen Code',
	kiro: 'Kiro CLI',
};

export const harnessTitle = (id, locale = getLocale()) => {
	if (id === 'workbuddy-ai') return 'WorkBuddy AI';
	return HARNESS_TITLES[id] || id;
};

const PURGE_EFFECTS_EN = {
	workbuddy: {
		channelType: 'config',
		typeLabel: 'Config',
		safetyLevel: 'safe',
		items: [
			'Writes the live system prompt into the plugin cache (welcomemode-*/prompt.tpl + interactionmode-*/fragments); marker-verified on 5.11.3',
			'Appends to behavior fragments instead of wiping tool and workflow notes',
			'Syncs identity context through personalization.customPrompt (app-config.json or settings.json)',
			'Saves a byte-level snapshot before editing; restores cleanly when disabled',
			'Upgrades rotate the cache version directory, so re-enable after an update',
		],
	},
	'workbuddy-ai': {
		channelType: 'config',
		typeLabel: 'Config',
		safetyLevel: 'safe',
		items: [
			'Writes the live system prompt into the plugin cache (~/.workbuddy-ai/plugins/cache/workbuddy-builtin)',
			'Syncs identity context through personalization.customPrompt (app-config.json first)',
			'Appends to behavior fragments instead of wiping tool and workflow notes',
			'Saves a byte-level snapshot before editing; restores cleanly when disabled',
			'Upgrades rotate the cache version directory, so re-enable after an update',
		],
	},
	dsh: {
		channelType: 'slash',
		typeLabel: 'Plugin',
		safetyLevel: 'hot',
		items: [
			'Collapses extra approval and request-interception prompts',
			'Removes memory and context noise',
			'Strips {{model}} template prefix to prevent host variable pollution',
			'In-memory hook only—never unpacks or modifies app.asar',
			'Instant toggle via /purge on / off',
		],
	},
	codebuddy: {
		channelType: 'shim',
		typeLabel: 'CLI Shim',
		safetyLevel: 'shim',
		items: [
			'Removes ~17k chars of built-in compliance and safety boilerplate',
			'Rebuilds system prompt via --system-prompt-file',
			'No on-disk config edits; removes CLI shim when disabled',
		],
	},
	antigravity: {
		channelType: 'config',
		typeLabel: 'Config',
		safetyLevel: 'safe',
		items: [
			'Manages global AGENTS.md automatically',
			'Appends persona as <user_rules>: built-in <identity> remains in the system prompt',
			'Saves a byte-level snapshot before editing; restores automatically when disabled',
		],
	},
	pi: {
		channelType: 'slash',
		typeLabel: 'Extension',
		safetyLevel: 'hot',
		items: [
			'Rewrites the system prompt before each turn',
			'/purge off reverts immediately and strips residual managed blocks in session',
			'No disk writes; active only in the current session',
		],
	},
	'pi-desktop': {
		channelType: 'slash',
		typeLabel: 'Plugin',
		safetyLevel: 'hot',
		items: [
			'Connects as an imported plugin; switch personas within the same session',
			'/purge off restores the host’s native state',
		],
	},
	omp: {
		channelType: 'slash',
		typeLabel: 'Extension',
		safetyLevel: 'hot',
		items: [
			'Rewrites the system prompt before each turn',
			'In-session toggle via /purge on / off',
			'Filters residual managed blocks when turned off',
		],
	},
	claude: {
		channelType: 'shim',
		typeLabel: 'CLI Shim',
		safetyLevel: 'shim',
		items: [
			'Replaces system prompt via --system-prompt-file (a 62-char identity line remains without binary patching)',
			'Preserves ~/.claude/CLAUDE.md and project rules',
		],
	},
	hermes: {
		channelType: 'shim',
		typeLabel: 'CLI Shim',
		safetyLevel: 'shim',
		items: [
			'Bypasses built-in rules with --ignore-rules',
			'Manages ~/.hermes/SOUL.md with lossless restoration',
		],
	},
	opencode: {
		channelType: 'slash',
		typeLabel: 'Plugin',
		safetyLevel: 'hot',
		items: [
			'Rewrites system prompt on each turn assembly',
			'Follows the active persona starting on the next turn',
		],
	},
	opencode2: {
		channelType: 'slash',
		typeLabel: 'Plugin',
		safetyLevel: 'hot',
		items: [
			'Rewrites system prompt on each turn assembly',
			'Persona switches take effect immediately without restarting the host',
		],
	},
	zcode: {
		channelType: 'config',
		typeLabel: 'Config',
		safetyLevel: 'safe',
		items: [
			'Manages global instructions in ~/.zcode/AGENTS.md',
			'Byte-level snapshot for clean restoration anytime',
		],
	},
	codex: {
		channelType: 'config',
		typeLabel: 'Config',
		safetyLevel: 'safe',
		items: [
			'Writes developer_instructions into ~/.codex/config.toml',
			'Preserves TOML structure and line endings; restores cleanly when disabled',
		],
	},
	grok: {
		channelType: 'config',
		typeLabel: 'Config',
		safetyLevel: 'safe',
		items: [
			'Writes ~/.grok/AGENTS.md, loaded at startup',
			'Byte-level snapshot; restores cleanly when disabled',
		],
	},
	kilo: {
		channelType: 'config',
		typeLabel: 'Config',
		safetyLevel: 'safe',
		items: [
			'Writes ~/.config/kilo/agent/code.md to replace code agent prompt (host soul() still prepends "You are Kilo")',
			'Original file snapshot; restores automatically when disabled',
		],
	},
};

export const harnessPurgeEffects = (id, locale = getLocale()) => PURGE_EFFECTS_EN[id] || null;
export const HARNESS_PURGE_EFFECTS = new Proxy({}, {
	get: (_, key) => harnessPurgeEffects(key),
	ownKeys: () => Object.keys(PURGE_EFFECTS_EN),
	getOwnPropertyDescriptor: (_, key) => ({ enumerable: true, configurable: true, value: harnessPurgeEffects(key) }),
});

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const personaName = (persona, locale = getLocale()) => persona?.meta?.name || persona?.id || 'None selected';
export function configurationOf(state) {
	return { persona: state.active ?? '', mode: state.paused ? state.prevMode || 'replace' : state.defaults?.mode || 'replace' };
}
export const changed = (draft, base) => JSON.stringify(draft) !== JSON.stringify(base);
export const needsApply = (state, draft, base) => state.defaultsSet === false || changed(draft, base);
/** Installation requires a binary, application directory, or non-residual configuration root. A leftover config alone does not count. */
export const installedOf = harness => Boolean(harness?.bin || harness?.install || ((harness?.found || harness?.homeExists) && !harness?.residueOnly));

/** Per-tool disablement is distinct from global pause and availability. */
export const disabledOf = harness => ['harness-disabled', 'harness-off'].includes(harness?.activation?.blockedBy);
export function sortedHarnesses(state, showAll = false) {
	const selected = h => (h.armed ?? []).some(c => c !== 'project');
	return [...(state.harnesses ?? [])]
		.filter(h => h.caps?.injectable !== false)
		// Keep planned hosts visible even when not installed.
		.filter(h => showAll || selected(h) || h.found || h.homeExists || h.planned)
		.sort((a, b) => Number(selected(b)) - Number(selected(a)) || Number(b.found) - Number(a.found) || a.id.localeCompare(b.id));
}

export function effectLabel(harness, paused = false, dshRuntime = null, locale = getLocale()) {
	const name = harnessTitle(harness.id ?? 'this target', locale);
	const on = (harness.armed ?? []).some(c => c !== 'project');
	if (on && paused) return 'Global pause active: config kept and will apply on resume';
	if (on && (harness.mode === 'off' || ['harness-off', 'harness-disabled'].includes(harness.activation?.blockedBy))) {
		return 'Disabled for this tool: resuming all will not re-enable it';
	}
	if (!on) {
		return harness.found || harness.homeExists
			? ''
			: 'Not installed locally; install first to enable';
	}
	if (harness.id === 'dsh' && dshRuntime) {
		const states = Object.entries(dshRuntime).filter(([, v]) => v && typeof v === 'object');
		const off = states.filter(([, v]) => v.enabled === false);
		const profiles = harness.profiles || ['desktop', 'web', 'headless', 'sdk'];
		if (profiles.length && profiles.every(p => dshRuntime[p]?.enabled === false)) {
			return 'All selected dsh profiles are paused by /purge off; run /purge on to resume';
		}
		if (off.length) {
			return `dsh profiles paused by /purge off: ${off.map(([p]) => p).join(', ')}; unlisted profiles unconfirmed`;
		}
	}
	const dynamic = harness.caps?.hot;
	if (dynamic?.ok && harness.armed.includes(dynamic.needs)) {
		if (dynamic.needs === 'slash' && harness.auto !== true) {
			return `Extension installed: reload ${name} and run /purge on to activate; current session unconfirmed`;
		}
		return 'Plugin loaded: applies on next turn; restart after first install or update; current session unconfirmed';
	}
	if (harness.armed.includes('install')) {
		return `Config written: new ${name} sessions will read it; active sessions unconfirmed`;
	}
	if (harness.armed.includes('slash')) {
		return `Run /purge on inside ${name} to activate; current session unconfirmed`;
	}
	return `CLI command managed: auto-injects when running ${name} in terminal`;
}

export function scopeSummary(state, locale = getLocale()) {
	const ids = Object.entries(state.armed ?? {})
		.filter(([, channels]) => (channels ?? []).some(c => c !== 'project'))
		.map(([id]) => harnessTitle(id, locale));
	if (state.paused) {
		return ids.length
			? `Paused; configurations kept for: ${listJoin(ids, locale)}`
			: 'Paused; no targets are currently using this persona';
	}
	if (!ids.length) {
		return 'Select targets to manage; after enabling a channel, check its detail panel for activation timing.';
	}
	return `${ids.length} target(s) selected: ${listJoin(ids, locale)}; check individual status for activation`;
}
