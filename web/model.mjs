import { getLocale, listJoin, pick } from './i18n.mjs';

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
			? pick(
				`这家只支持：${declared.map(m => labels[m] || m).join(' / ')}`,
				`Supports only: ${declared.map(m => labels[m] || m).join(' / ')}`,
				locale,
			)
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
export const personaName = (persona, locale = getLocale()) => persona?.meta?.name || persona?.id || pick('未选择', 'None selected', locale);
export function configurationOf(state) {
	return { persona: state.active ?? '', mode: state.paused ? state.prevMode || 'replace' : state.defaults?.mode || 'replace' };
}
export const changed = (draft, base) => JSON.stringify(draft) !== JSON.stringify(base);
export const needsApply = (state, draft, base) => state.defaultsSet === false || changed(draft, base);
/** 「装没装」只看程序本体：命令、安装目录（含 macOS 的 .app），或配置根在且不是「只剩残留」。
 *  只有配置目录（CLI 卸载后留下的 config.toml、别的工具写进去的 skills）不算装上——
 *  否则未安装的家会被画成「可接管」，开关点开也写不进任何地方。 */
export const installedOf = harness => Boolean(harness?.bin || harness?.install || ((harness?.found || harness?.homeExists) && !harness?.residueOnly));

/** 这家被单独关掉（不是全局暂停）：界面要把「已关闭」和「可接管」分开画。 */
export const disabledOf = harness => ['harness-disabled', 'harness-off'].includes(harness?.activation?.blockedBy);
export function sortedHarnesses(state, showAll = false) {
	const selected = h => (h.armed ?? []).some(c => c !== 'project');
	return [...(state.harnesses ?? [])]
		.filter(h => h.caps?.injectable !== false)
		// planned 的家（kiro / goose）本机没装也要列出来：用户需要知道「未来会支持」。
		.filter(h => showAll || selected(h) || h.found || h.homeExists || h.planned)
		.sort((a, b) => Number(selected(b)) - Number(selected(a)) || Number(b.found) - Number(a.found) || a.id.localeCompare(b.id));
}

export function effectLabel(harness, paused = false, dshRuntime = null, locale = getLocale()) {
	const name = harnessTitle(harness.id ?? pick('这个执行器', 'this target', locale), locale);
	const on = (harness.armed ?? []).some(c => c !== 'project');
	if (on && paused) return pick('总电源已暂停：配置留着，恢复后按原范围应用', 'Global pause active: config kept and will apply on resume', locale);
	if (on && (harness.mode === 'off' || ['harness-off', 'harness-disabled'].includes(harness.activation?.blockedBy))) {
		return pick('这家已关闭：恢复全部也不会自动启用', 'Disabled for this tool: resuming all will not re-enable it', locale);
	}
	if (!on) {
		return harness.found || harness.homeExists
			? ''
			: pick('本机没装，装好后再回来开', 'Not installed locally; install first to enable', locale);
	}
	if (harness.id === 'dsh' && dshRuntime) {
		const states = Object.entries(dshRuntime).filter(([, v]) => v && typeof v === 'object');
		const off = states.filter(([, v]) => v.enabled === false);
		const profiles = harness.profiles || ['desktop', 'web', 'headless', 'sdk'];
		if (profiles.length && profiles.every(p => dshRuntime[p]?.enabled === false)) {
			return pick('dsh 已选形态均被 /purge off 暂停；在对应形态执行 /purge on 恢复', 'All selected dsh profiles are paused by /purge off; run /purge on to resume', locale);
		}
		if (off.length) {
			return pick(
				`dsh 这些形态被 /purge off 暂停：${off.map(([p]) => p).join('、')}；未列出的形态尚未确认`,
				`dsh profiles paused by /purge off: ${off.map(([p]) => p).join(', ')}; unlisted profiles unconfirmed`,
				locale,
			);
		}
	}
	const dynamic = harness.caps?.hot;
	if (dynamic?.ok && harness.armed.includes(dynamic.needs)) {
		if (dynamic.needs === 'slash' && harness.auto !== true) {
			return pick(
				`扩展已安装：重新加载 ${name} 后执行 /purge on 生效；当前会话还没确认`,
				`Extension installed: reload ${name} and run /purge on to activate; current session unconfirmed`,
				locale,
			);
		}
		return pick(
			'插件已加载：下一轮读取；首次安装或更新代码后要重启；当前会话还没确认',
			'Plugin loaded: applies on next turn; restart after first install or update; current session unconfirmed',
			locale,
		);
	}
	if (harness.armed.includes('install')) {
		return pick(
			`配置已写入：新开 ${name} 读取；现有会话还没确认`,
			`Config written: new ${name} sessions will read it; active sessions unconfirmed`,
			locale,
		);
	}
	if (harness.armed.includes('slash')) {
		return pick(
			`在 ${name} 里执行 /purge on 后生效；当前会话还没确认`,
			`Run /purge on inside ${name} to activate; current session unconfirmed`,
			locale,
		);
	}
	return pick(
		`已接管命令行：终端敲 ${name} 时自动注入`,
		`CLI command managed: auto-injects when running ${name} in terminal`,
		locale,
	);
}

export function scopeSummary(state, locale = getLocale()) {
	const ids = Object.entries(state.armed ?? {})
		.filter(([, channels]) => (channels ?? []).some(c => c !== 'project'))
		.map(([id]) => harnessTitle(id, locale));
	if (state.paused) {
		return ids.length
			? pick(`已暂停，这些执行器的配置还留着：${listJoin(ids, locale)}`, `Paused; configurations kept for: ${listJoin(ids, locale)}`, locale)
			: pick('已暂停，暂时没有执行器在用这份人设', 'Paused; no targets are currently using this persona', locale);
	}
	if (!ids.length) {
		return pick('选择要管理的执行器；写入通道后，按详情提示检查生效时机。', 'Select targets to manage; after enabling a channel, check its detail panel for activation timing.', locale);
	}
	return pick(
		`已选择 ${ids.length} 个执行器：${listJoin(ids, locale)}；实际生效看各自状态`,
		`${ids.length} target(s) selected: ${listJoin(ids, locale)}; check individual status for activation`,
		locale,
	);
}
