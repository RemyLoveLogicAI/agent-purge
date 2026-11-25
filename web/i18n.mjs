// Bilingual (en / zh-CN) dictionary and helpers for the Web console.
// Defaults to English ("en") unless the server-detected or user-selected locale is Chinese.

const normalize = (value) => {
	if (typeof value !== 'string') return 'en';
	const v = value.trim().toLowerCase();
	return v === 'zh' || v.startsWith('zh-') ? 'zh-CN' : 'en';
};

let currentLocale = (() => {
	if (typeof document !== 'undefined') {
		const meta = document.querySelector('meta[name="ap-locale"]')?.getAttribute('content');
		if (meta && meta !== 'auto') return normalize(meta);
		const lang = document.documentElement?.getAttribute('lang');
		if (lang) return normalize(lang);
	}
	return 'en';
})();

export function getLocale() {
	return currentLocale;
}

export function isZh(locale = currentLocale) {
	return normalize(locale) === 'zh-CN';
}

export function setLocale(locale) {
	currentLocale = normalize(locale);
	if (typeof document !== 'undefined' && document.documentElement) {
		document.documentElement.lang = currentLocale;
	}
	return currentLocale;
}

export const fmtNumber = (n, locale = currentLocale) => Number(n || 0).toLocaleString(isZh(locale) ? 'zh-CN' : 'en-US');

export const fmtTime = (date, locale = currentLocale) =>
	new Date(date).toLocaleTimeString(isZh(locale) ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' });

export const fmtDateTime = (date, options = undefined, locale = currentLocale) =>
	new Date(date).toLocaleString(isZh(locale) ? 'zh-CN' : 'en-US', options);

export const listJoin = (items, locale = currentLocale) => items.join(isZh(locale) ? '、' : ', ');

export function pick(zh, en, locale = currentLocale) {
	return isZh(locale) ? zh : en;
}

export const MESSAGES = {
	en: {
		'page.title': 'agent-purge · Prompt Console',
		'skip.main': 'Skip to main content',
		'brand.aria': 'agent-purge console',
		'nav.aria': 'Primary navigation',
		'nav.console': 'Console',
		'nav.library': 'Personas',
		'nav.project': 'Rule Files',
		'nav.diagnostics': 'Tests & Logs',
		'nav.settings': 'Settings',
		'conn.connecting': 'Connecting to local service',
		'conn.connected': 'Connected · {time}',
		'conn.stopped': 'Service stopped',
		'conn.disconnected': 'Local service disconnected',
		'conn.disconnectedNotice': '{error} Use the refresh button in the top right to retry.',
		'version.loading': 'Loading…',
		'version.checkTitle': 'Check for updates',
		'theme.toDark': 'Switch to dark mode',
		'theme.toLight': 'Switch to light mode',
		'refresh.title': 'Refresh status',
		'exit.title': 'Stop local agent-purge service and close window',
		'exit.aria': 'Exit application',
		'exit.confirmUnsaved': 'There are unsaved settings or drafts. Stop and close anyway?',
		'exit.stopping': 'Stopping local service and closing window…',

		'console.currentPersona': 'Current Persona',
		'console.reading': 'Loading…',
		'console.readingDesc': 'Loading persona description…',
		'console.switchPersona': 'Switch Persona',
		'console.editBody': 'Edit',
		'console.newPersona': 'New',
		'console.pullGithub': 'Pull from GitHub',
		'console.managedRatio': 'managed',
		'console.powerReading': 'Loading',
		'console.powerConnecting': 'Connecting…',
		'console.disarmAll': 'Disarm All',
		'console.disarmAllTitle': 'Revoke all enabled prompt configurations and restore original files; persona files are kept',
		'console.defaultMode': 'Default Mode',
		'mode.replace': 'Replace Identity',
		'mode.strict': 'Persona Only',
		'mode.append': 'Append',
		'mode.off': 'Paused',
		'mode.hintDefault': 'Replaces the assistant identity while keeping host tools and rules.',
		'console.applyChanges': 'Apply Changes',
		'console.saveSettings': 'Save Settings',
		'console.applying': 'Applying…',
		'console.discardChanges': 'Discard',
		'console.scopeTitle': 'Managed Targets',
		'console.targetsCount': '{count} targets',
		'console.targetsVisibleCount': '{visible} / {total} targets',
		'console.detecting': 'Detecting installed AI clients…',
		'console.searchPlaceholder': 'Search tools, commands, or status',
		'console.searchAria': 'Search managed targets',
		'console.filterAria': 'Filter managed targets',
		'console.filterAll': 'All',
		'console.filterOn': 'Managed',
		'console.filterReady': 'Ready',
		'console.showAll': 'Show uninstalled',
		'console.batchAria': 'Batch actions',
		'console.batchTitle': 'Batch-configure managed targets or modes',
		'console.batchPlaceholder': 'Batch actions…',
		'console.batchEnableReady': 'Enable all ready tools',
		'console.batchDisableAll': 'Disable all targets',
		'console.batchModePreferred': 'Restore recommended modes',
		'console.batchModeReplace': 'Set all to "Replace Identity"',
		'console.batchModeStrict': 'Set all to "Persona Only"',
		'console.targetListAria': 'Managed targets list',
		'console.drawerAria': 'Target configuration details',
		'console.launchPrefs': 'CLI Launch Preference',
		'console.unset': 'Not set',
		'console.launchHint': 'Client launched when running agent-purge directly in a terminal; does not affect the targets above.',
		'console.preferredClient': 'Preferred client',
		'console.save': 'Save',

		'library.title': 'Personas',
		'library.subtitle': 'The body is written into prompts; name and description are for management only.',
		'library.pullExternal': 'Pull External',
		'library.newPersona': 'New Persona',
		'library.listAria': 'Persona list',
		'library.searchAria': 'Search personas',
		'library.searchPlaceholder': 'Search name or description',
		'library.editorAria': 'Persona editor',
		'library.editorEmpty': 'Select a persona on the left to view or edit its content.',
		'library.editTitle': 'Edit Persona',
		'library.editCurrentTitle': 'Edit Current Persona',
		'library.newTitle': 'New Persona',
		'library.unmodified': 'Unmodified',
		'library.unsaved': 'Unsaved',
		'library.saved': 'Saved',
		'library.fieldId': 'ID',
		'library.idHint': 'Letters, numbers, hyphens, underscores; cannot be changed after creation.',
		'library.fieldName': 'Display Name',
		'library.fieldDesc': 'Description',
		'library.fieldBody': 'Persona Content',
		'library.advancedMeta': 'Advanced Metadata',
		'library.fieldModel': 'Suggested Models (comma-separated, leave blank for any)',
		'library.delete': 'Delete',
		'library.saveAndSync': 'Save & Sync',
		'library.saveAndApply': 'Save & Apply',

		'project.title': 'Rule Files',
		'project.subtitle': 'Append a managed persona block to project or global tool rule files; preserves original content and can be removed anytime.',
		'project.scopeLabel': 'Scope',
		'project.scopeProject': 'Current Project',
		'project.scopeGlobal': 'Global Directory',
		'project.personaLabel': 'Persona to Write',
		'project.dirLabel': 'Project Directory',
		'project.dirPlaceholder': 'e.g. /home/user/my-project',
		'project.load': 'Load',
		'project.cwd': 'Current Dir',
		'project.recentAria': 'Recent projects',
		'project.noteAria': 'Rule file behavior',
		'project.globalPersona': 'Global Persona',
		'project.sysTakeover': 'System Prompt Injection',
		'project.sysTakeoverDesc': 'Managed in Console, takes effect via each tool’s system entry',
		'project.ruleFiles': 'Rule Files',
		'project.scopeProjectHeading': 'Rule files in current directory',
		'project.scopeGlobalHeading': 'Global rule files per tool',
		'project.scopeDesc': 'Appends a managed block at the end of existing rule files without altering original rules; removable anytime.',
		'project.loading': 'Loading rule files…',
		'project.footnote': 'Rule files only affect the target project or global config directory; blocks are appended at the end without modifying existing rules. "Disarm All" does not touch project rules—click "Remove" here to revert cleanly.',

		'diag.title': 'Tests & Logs',
		'diag.subtitle': 'Inspect configuration writes and actual request verification separately. Test runs never touch your active sessions.',
		'diag.resyncAll': 'Re-sync Active Targets',
		'diag.lastApply': 'Last Apply',
		'diag.retryFailed': 'Retry Failed',
		'diag.noApplyYet': 'No apply records yet.',
		'diag.captureTitle': 'Dry-Run Verification',
		'diag.captureSubtitle': 'Runs each tool in an isolated temporary directory with a test persona to verify whether requests carry the persona.',
		'diag.noCaptureYet': 'No verification report loaded yet.',
		'diag.runtimeState': 'Runtime State & Paths',
		'diag.runtimeHint': 'Targets without runtime confirmation are not marked as active in the current session. Reload the host after installing or updating plugins.',

		'settings.title': 'Settings',
		'settings.subtitle': 'Interface language, appearance, desktop window behavior, and WebDAV backup. Everything is stored locally.',
		'settings.languageTitle': 'Language',
		'settings.languageDesc': 'The interface uses English for all locale settings.',
		'settings.languageLabel': 'Interface Language',
		'settings.languageAuto': 'Auto (System Locale)',
		'settings.languageEn': 'English',
		'settings.languageZh': 'English (legacy locale)',
		'settings.saveLanguage': 'Save Language',
		'settings.languageSaved': 'Language preference updated.',
		'settings.themeTitle': 'Appearance',
		'settings.themeDesc': 'Auto follows your system light or dark preference; you can also toggle anytime from the top bar.',
		'settings.themeLabel': 'Theme',
		'settings.themeAuto': 'Auto (Follow System)',
		'settings.themeLight': 'Light',
		'settings.themeDark': 'Dark',
		'settings.saveTheme': 'Save Theme',
		'settings.themeSaved': 'Theme preference updated.',
		'settings.desktopTitle': 'Desktop Window',
		'settings.desktopSubtitle': 'Applies only when launched via desktop icon / executable; terminal runs of agent-purge web are managed by the terminal.',
		'settings.closeActionLabel': 'When closing window',
		'settings.closeExit': 'Exit local service',
		'settings.closeStay': 'Keep service in background (reconnect on next launch)',
		'settings.closeHint': 'Takes effect immediately for the next window close.',
		'settings.confirmClose': 'Confirm before closing window',
		'settings.saveDesktop': 'Save Window Settings',
		'settings.webdavTitle': 'WebDAV Backup',
		'settings.webdavSubtitle': 'Backs up personas and settings (the WebDAV password in state.json is never included). Restore overwrites matching local files after saving a snapshot in backups/.',
		'settings.webdavUrl': 'URL',
		'settings.webdavDir': 'Remote Directory',
		'settings.webdavUsername': 'Username',
		'settings.webdavPassword': 'Password',
		'settings.webdavPasswordKeep': 'Saved; leave blank to keep',
		'settings.webdavPasswordUnset': 'Not set',
		'settings.webdavPasswordPlaceholder': 'Leave blank to keep unchanged',
		'settings.webdavSaveTest': 'Save & Test Connection',
		'settings.webdavBackup': 'Back Up Now',
		'settings.webdavRestore': 'Restore from Backup',

		'footer.note': 'Configuration writes and session activation are separate: refer to executor callbacks and request evidence.',

		'import.title': 'Pull Personas from External Source',
		'import.closeAria': 'Close',
		'import.subtitle': 'Supports public GitHub repositories (owner/repo) or a local directory; imports .md prompt files and skips docs automatically.',
		'import.recommended': 'Recommended',
		'import.sourceLabel': 'Source',
		'import.sourcePlaceholder': 'owner/repo or /path/to/prompts',
		'import.mirrorLabel': 'GitHub Mirror (Optional)',
		'import.mirrorPlaceholder': 'e.g. https://gh-proxy.com (leave blank for direct)',
		'import.mirrorHint': 'Proxy prefix for GitHub API & raw files in restricted networks; saved locally and leave blank for direct access.',
		'import.overwrite': 'Overwrite existing IDs',
		'import.cancel': 'Cancel',
		'import.start': 'Start Pull',
		'import.pulling': 'Pulling…',

		'update.title': 'Update Available',
		'update.desc': 'A newer version is available and can be upgraded in place.',
		'update.currentTag': 'Current v{version}',
		'update.latestTag': 'Latest v{version}',
		'update.changelog': 'Release Notes',
		'update.commandLabel': 'Terminal Upgrade Command',
		'update.copy': 'Copy',
		'update.later': 'Later',
		'update.releasePage': 'Release Page',
		'update.upgradeNow': 'Upgrade Now',

		'confirm.title': 'Confirm Enabling Target',
		'confirm.desc': 'Enabling will rewrite the target tool’s system prompt and may strip built-in identity and restrictions.',
		'confirm.targetTool': 'Target Tool',
		'confirm.badgeConfig': 'Config',
		'confirm.backupTitle': 'Full backup before writing',
		'confirm.backupDesc': 'A SHA256 snapshot of every modified file is saved before writing and restored byte-for-byte when disabled. Your personas and custom edits remain safe.',
		'confirm.legalTitle': 'Notice',
		'confirm.legalDesc': 'For local lawful persona customization and model instruction research only. Enabling strips or rewrites host built-in system prompts; please comply with each software’s terms of use and take responsibility for generated output.',
		'confirm.cancel': 'Cancel',
		'confirm.submit': 'Confirm & Enable',
	},
	'zh-CN': null,
};
// Preserve the legacy locale key while serving the English catalog.
MESSAGES['zh-CN'] = { ...MESSAGES.en };

export function t(key, vars = undefined, locale = currentLocale) {
	const table = MESSAGES[normalize(locale)] || MESSAGES.en;
	let template = table[key] ?? MESSAGES.en[key] ?? key;
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			template = template.replaceAll(`{${k}}`, String(v ?? ''));
		}
	}
	return template;
}

export function applyDomI18n(root = typeof document !== 'undefined' ? document : null, locale = currentLocale) {
	if (!root) return;
	if (root.documentElement) root.documentElement.lang = normalize(locale);
	if (root.title !== undefined) document.title = t('page.title', undefined, locale);
	for (const el of root.querySelectorAll('[data-i18n]')) {
		el.textContent = t(el.dataset.i18n, undefined, locale);
	}
	for (const el of root.querySelectorAll('[data-i18n-attr]')) {
		for (const pair of el.dataset.i18nAttr.split(',')) {
			const [attr, key] = pair.split(':').map(s => s.trim());
			if (attr && key) el.setAttribute(attr, t(key, undefined, locale));
		}
	}
}
