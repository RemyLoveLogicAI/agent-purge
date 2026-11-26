// Desktop preferences: window behavior and WebDAV backup account.
//
// All live in the settings section of state.json alongside persona and takeover configuration; one distinction:
// webdav.password is plaintext in the local file only and never appears in API responses.
import { updateState } from "./state.mjs";
import { normalizeLanguageSetting } from "./i18n.mjs";
import { normalizeMirror } from "./persona-import.mjs";

export const DEFAULT_WEBDAV_DIR = "agent-purge";
export const THEMES = ["auto", "light", "dark"];
const text = value => (typeof value === "string" ? value.trim() : "");
const safeMirror = value => { try { return normalizeMirror(value); } catch { return ""; } };

export function normalizeThemeSetting(value) {
	if (typeof value !== "string") return "auto";
	const raw = value.trim().toLowerCase();
	return THEMES.includes(raw) ? raw : "auto";
}

function badSetting(message) {
	return Object.assign(new Error(message), { statusCode: 400 });
}

/**
 * Settings shape usable directly by the frontend.
 * Report only whether a password exists; echoing it would expose credentials to anyone who can open the local page.
 */
export function settingsOf(state) {
	const raw = state?.settings ?? {};
	const desktop = raw.desktop ?? {};
	const webdav = raw.webdav ?? {};
	return {
		language: normalizeLanguageSetting(raw.language),
		theme: normalizeThemeSetting(raw.theme),
		githubMirror: safeMirror(raw.githubMirror),
		desktop: {
			// Default: exit when the window closes, with confirmation first (desktop double-click behavior).
			exitOnClose: desktop.exitOnClose !== false,
			confirmOnClose: desktop.confirmOnClose !== false,
		},
		webdav: {
			url: text(webdav.url),
			username: text(webdav.username),
			dir: text(webdav.dir) || DEFAULT_WEBDAV_DIR,
			hasPassword: Boolean(text(webdav.password)),
			lastBackupAt: text(webdav.lastBackupAt) || null,
			lastRestoreAt: text(webdav.lastRestoreAt) || null,
		},
	};
}

/** Server only: full settings including the password, used for WebDAV requests. */
export function settingsWithSecret(state) {
	const view = settingsOf(state);
	return { ...view, webdav: { ...view.webdav, password: text(state?.settings?.webdav?.password) } };
}

/** Whether closing the desktop window exits the service; use the default if configuration cannot be read. */
export function desktopExitOnClose(state) {
	try { return settingsOf(state).desktop.exitOnClose; } catch { return true; }
}

/**
 * Save settings, overwriting only keys named in the payload and preserving other user-written state.json fields.
 * @param {string} root data directory
 * @param {{ desktop?: { exitOnClose?: boolean, confirmOnClose?: boolean },
 *           webdav?: { url?: string, username?: string, password?: string, dir?: string } }} payload
 */
export function saveSettings(root, payload = {}) {
	const desktopPatch = payload.desktop ?? {};
	const webdavPatch = payload.webdav ?? {};
	if (typeof desktopPatch !== "object" || typeof webdavPatch !== "object") throw badSetting("Invalid settings payload");
	let themePatch;
	if (payload.theme !== undefined) {
		if (typeof payload.theme !== "string") throw badSetting("Theme mode must be a string");
		const candidate = payload.theme.trim().toLowerCase();
		if (!THEMES.includes(candidate)) throw badSetting("Theme mode must be auto, light, or dark");
		themePatch = candidate;
	}
	const url = webdavPatch.url === undefined ? undefined : text(webdavPatch.url);
	if (url !== undefined && url && !/^https?:\/\//i.test(url)) throw badSetting("WebDAV URL must start with http:// or https://");
	const dir = webdavPatch.dir === undefined ? undefined : text(webdavPatch.dir).replace(/^\/+|\/+$/g, "");
	if (dir !== undefined && dir.split("/").some(segment => segment === "..")) throw badSetting("Remote directory must not contain ..");
	const githubMirror = payload.githubMirror === undefined ? undefined : normalizeMirror(payload.githubMirror);
	return updateState(root, state => {
		const current = state.settings ?? {};
		const language = payload.language !== undefined ? normalizeLanguageSetting(payload.language) : normalizeLanguageSetting(current.language);
		const theme = themePatch ?? normalizeThemeSetting(current.theme);
		const desktop = { ...(current.desktop ?? {}) };
		for (const key of ["exitOnClose", "confirmOnClose"]) {
			if (desktopPatch[key] !== undefined) desktop[key] = desktopPatch[key] === true;
		}
		const webdav = { ...(current.webdav ?? {}) };
		for (const [key, value] of [["url", url], ["username", webdavPatch.username], ["dir", dir]]) {
			if (value !== undefined) webdav[key] = text(value);
		}
		if (webdavPatch.password !== undefined) {
			const password = text(webdavPatch.password);
			if (password) webdav.password = password;
			else delete webdav.password; // Empty string clears the saved password
		}
		const nextSettings = { ...current, language, theme, desktop, webdav };
		if (githubMirror !== undefined) {
			if (githubMirror) nextSettings.githubMirror = githubMirror;
			else delete nextSettings.githubMirror;
		}
		return { ...state, settings: nextSettings };
	});
}

/** Write back the timestamp after a successful backup or restore so settings can show the last backup. */
export function noteWebdavRun(root, patch) {
	return updateState(root, state => {
		const current = state.settings ?? {};
		return { ...state, settings: { ...current, webdav: { ...(current.webdav ?? {}), ...patch } } };
	});
}
