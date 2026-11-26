// Locate desktop installations: Start Menu shortcuts → user installation directories → common drive roots → registry uninstall entries.
// CLIs can be found on PATH; desktop apps such as Electron may be installed on any drive or directory (F:\workbuddy),
// and double-click launch bypasses PATH, so fixed paths alone produce false negatives.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join, win32 } from "node:path";
import { execFileSync } from "node:child_process";

const WIN = process.platform === "win32";

// Shortcut and registry paths are Windows paths, but tests may run on Linux;
// select the path dialect based on its appearance so assertions work on both.
const isWinPath = (p) => p.length > 2 && p[1] === ":" && (p.charCodeAt(2) === 92 || p.charCodeAt(2) === 47);
const baseOf = (p) => (isWinPath(p) ? win32.basename(p) : basename(p));
const dirOf = (p) => (isWinPath(p) ? win32.dirname(p) : dirname(p));
const hasWildcard = (p) => p.includes("*");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Executable matching supports versioned portable names such as `PI-Desktop-Portable*.exe`.
 * Apply wildcards only when explicitly specified so `Antigravity.exe` does not match `antigravity-tools.exe`.
 */
export function matchExeName(name, pattern) {
	const n = lower(name);
	const p = lower(pattern);
	if (!hasWildcard(p)) return n === p;
	return new RegExp(`^${p.split("*").map(escapeRe).join(".*")}$`).test(n);
}

// ---------- .lnk parsing (LinkInfo.LocalBasePath; scan drive paths if parsing fails) ----------

export function readShortcutTarget(file) {
	let buf;
	try {
		buf = readFileSync(file);
	} catch {
		return null;
	}
	if (buf.length < 0x4c || buf.readUInt32LE(0) !== 0x4c) return null;
	const flags = buf.readUInt32LE(0x14);
	let at = 0x4c;
	if (flags & 1) at += 2 + (buf.readUInt16LE(at) || 0);
	if (flags & 2 && at + 0x1c <= buf.length) {
		const base = at;
		const size = buf.readUInt32LE(base);
		const headerSize = buf.readUInt32LE(base + 4);
		const infoFlags = buf.readUInt32LE(base + 8);
		if (size && headerSize >= 0x1c && base + size <= buf.length) {
			const ansi = (field) => {
				const off = buf.readUInt32LE(base + field);
				return off && base + off < buf.length ? cstr(buf, base + off) : "";
			};
			const unicode = (field) => {
				const off = buf.readUInt32LE(base + field);
				return off && base + off < buf.length ? cstr16(buf, base + off) : "";
			};
			const wide = headerSize >= 0x24;
			let path = "";
			if (infoFlags & 1) path = wide ? unicode(0x1c) : ansi(16);
			const suffix = wide ? unicode(0x20) : ansi(0x18);
			if (!path) path = ansi(16);
			if (path) return trimExe(path + (suffix || ""));
		}
	}
	return scanExePath(buf);
}

/** .lnk LocalBasePath uses the system ANSI code page (GBK on Chinese systems), not latin1:
 *  A GBK-encoded non-ASCII installation path decoded as latin1 becomes garbled and does not exist.
 *  Decode using the code page; fall back to latin1 for unknown code pages or invalid bytes to preserve previous behavior. */
const ansiDecoder = (() => {
	let label = "";
	try {
		const cp = execFileSync("reg", ["query", String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`, "/v", "ACP"], {
			encoding: "utf8",
			timeout: 2000,
			windowsHide: true,
		});
		const m = cp.match(/ACP\s+REG_SZ\s+([0-9]+)/);
		if (m) label = m[1] === "936" ? "gbk" : m[1] === "950" ? "big5" : m[1] === "932" ? "shift_jis" : m[1] === "949" ? "euc-kr" : m[1] === "1252" ? "windows-1252" : `windows-${m[1]}`;
	} catch {
		// Use the platform default if unavailable (Node TextDecoder("gbk") works on Chinese Windows).
		label = "";
	}
	const candidates = [label, "gbk", "big5", "windows-1252"].filter(Boolean);
	for (const enc of candidates) {
		try {
			return new TextDecoder(enc, { fatal: true });
		} catch {}
	}
	return null;
})();

function decodeAnsi(buf, start, end) {
	const bytes = buf.subarray(start, end);
	if (!ansiDecoder) return buf.toString("latin1", start, end);
	try {
		return ansiDecoder.decode(bytes);
	} catch {
		return buf.toString("latin1", start, end);
	}
}

function cstr(buf, start) {
	let end = start;
	while (end < buf.length && buf[end] !== 0) end++;
	return decodeAnsi(buf, start, end);
}

function cstr16(buf, start) {
	let end = start;
	while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2;
	return buf.toString("utf16le", start, end);
}

/** Fallback: extract the first printable `X:\...\xxx.exe` string from the binary. */
function scanExePath(buf) {
	for (const enc of ["latin1", "utf16le"]) {
		const m = buf.toString(enc).match(/[A-Za-z]:[\\/][^\0<>|*?"\r\n]{1,240}?\.exe/i);
		if (m) return m[0];
	}
	return null;
}

function trimExe(p) {
	const s = String(p).replace(/\0.*$/, "").trim();
	const m = s.match(/^[A-Za-z]:[\\/][\s\S]*?\.exe/i);
	return m ? m[0] : s || null;
}

// ---------- Data sources ----------

function startMenuRoots(home) {
	const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
	const programData = process.env.ProgramData || process.env.ALLUSERSPROFILE || "C:\\ProgramData";
	return [
		join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
		join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
		join(home, "Desktop"),
		join(process.env.PUBLIC || "C:\\Users\\Public", "Desktop"),
	];
}

function walkShortcuts(dir, out, depth = 0) {
	if (depth > 4) return out;
	let items;
	try {
		items = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const item of items) {
		const full = join(dir, item.name);
		if (item.isDirectory()) walkShortcuts(full, out, depth + 1);
		else if (/\.lnk$/i.test(item.name)) out.push(full);
	}
	return out;
}

/** Shortcut index: lowercased lnk filename without extension + target exe name → target path. */
export function shortcutIndex(home = process.env.USERPROFILE || process.env.HOME) {
	const index = new Map();
	for (const root of startMenuRoots(home)) {
		for (const lnk of walkShortcuts(root, [])) {
			const target = readShortcutTarget(lnk);
			if (!target) continue;
			index.set(basename(lnk, ".lnk").toLowerCase(), target);
			index.set(baseOf(target).toLowerCase(), target);
		}
	}
	return index;
}

/** Registry uninstall entries: search by display name (full /s on HKLM takes over 3 seconds and should not run on every startup). */
export function uninstallEntries(match) {
	if (!WIN || !match) return [];
	const roots = [
		String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
		String.raw`HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall`,
		String.raw`HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`,
	];
	const out = [];
	for (const root of roots) {
		let text = "";
		try {
			text = execFileSync("reg", ["query", root, "/s", "/f", match, "/d"], {
				encoding: "latin1",
				timeout: 4000,
				windowsHide: true,
			});
		} catch {
			continue;
		}
		let cur = null;
		for (const line of text.split(/\r?\n/)) {
			if (/^HKEY_/i.test(line)) {
				if (cur) out.push(cur);
				cur = { name: "", location: "", icon: "" };
				continue;
			}
			const m = line.match(/^\s{4}(\S+)\s+REG_[A-Z_]+\s+(.*)$/);
			if (!m || !cur) continue;
			const value = m[2].trim().replace(/^"|"$/g, "");
			if (m[1] === "DisplayName") cur.name = value;
			else if (m[1] === "InstallLocation") cur.location = value;
			else if (m[1] === "DisplayIcon") cur.icon = value.replace(/,\d+$/, "");
		}
		if (cur) out.push(cur);
	}
	return out.filter((e) => e.name);
}

/** Mapped network drive letters in uppercase. `HKCU\Network` is language independent: query the registry rather than the drives. */
export function mappedDriveLetters(text) {
	const letters = new Set();
	for (const m of String(text ?? "").matchAll(/^HKEY_CURRENT_USER\\Network\\([A-Za-z])(?=\s|$)/gim)) letters.add(m[1].toUpperCase());
	return letters;
}

// reg starts a process (~12ms); do not query it every minute like the drive cache.
let networkCache = { at: 0, letters: new Set() };
function networkDrives() {
	if (networkCache.at && Date.now() - networkCache.at < 5 * 60_000) return networkCache.letters;
	let letters = new Set();
	try {
		letters = mappedDriveLetters(
			execFileSync("reg", ["query", String.raw`HKCU\Network`], { encoding: "latin1", timeout: 2000, windowsHide: true }),
		);
	} catch {
		// This key does not exist when no network drive has been mapped (reg exit code 1); treat as none, as before.
	}
	networkCache = { at: Date.now(), letters };
	return letters;
}

/** Drive detection: skip mapped network drives and probe local drives only.
 *  existsSync on disconnected mapped drives waits for an SMB timeout (~21 seconds per drive, blocking the event loop, #22);
 *  local drives take 0-1ms, making a full scan inexpensive on normal machines.
 *  Desktop apps installed on network drives can still be found via shortcuts or registry uninstall entries.
 *  `slow` handles mappings absent from the registry (session `net use /persistent:no`): the first probe can time out,
 *  but after measuring it as nonlocal, subsequent probes and cache refreshes do not wait again. */
const slowDrives = new Set();
export function localDriveRoots({ network = networkDrives(), probe = existsSync, slow = slowDrives, slowAfterMs = 300 } = {}) {
	const list = [];
	for (let i = 67; i <= 90; i++) {
		const letter = String.fromCharCode(i);
		if (network.has(letter) || slow.has(letter)) continue;
		const root = `${letter}:\\`;
		const started = Date.now();
		let hit = false;
		try {
			hit = probe(root);
		} catch {}
		if (Date.now() - started >= slowAfterMs) slow.add(letter);
		if (hit) list.push(root);
	}
	return list;
}

/** Local drive letters (last-resort fallback, cached for 60 seconds). */
let driveCache = { at: 0, list: [] };
export function fixedDrives() {
	// Tests and slow or disconnected drive scenarios may explicitly specify scan roots on any platform.
	const override = process.env.AGENT_PURGE_DRIVES;
	if (override) return override.split(";").map((s) => s.trim()).filter(Boolean);
	if (!WIN) return [];
	if (Date.now() - driveCache.at < 60_000) return driveCache.list;
	const list = localDriveRoots();
	driveCache = { at: Date.now(), list };
	return list;
}

export function defaultSources(home = process.env.USERPROFILE || process.env.HOME) {
	const sources = {
		home,
		local: process.env.LOCALAPPDATA || join(home, "AppData", "Local"),
		roaming: process.env.APPDATA || join(home, "AppData", "Roaming"),
		drives: fixedDrives(),
	};
	// macOS /Applications is absolute and unaffected by sandboxed USERPROFILE / HOME:
	// without isolation tests would detect real installations, so provide an override.
	const appDirs = process.env.AGENT_PURGE_APP_DIRS;
	if (appDirs) sources.appDirs = appDirs.split(";").map((s) => s.trim()).filter(Boolean);
	return sources;
}

// ---------- Shallow drive scan (fallback for missing shortcuts and nonstandard directories) ----------
// Scan each drive once (depth 3, skip system directories, time budget) and index all desktop executable names;
// subsequent locate calls consult the index, finding unusual paths without scanning the entire drive.
const SCAN_SKIP = new Set([
	"windows",
	"$recycle.bin",
	"system volume information",
	"programdata",
	"node_modules",
	"appdata",
	"perflogs",
	"recovery",
	"$windows.~bt",
	"$windows.~ws",
	".git",
]);
const scanTargets = new Set();
let scanWildcards = [];
const driveIndex = new Map();
const SCAN_TTL = 10 * 60_000;
const SCAN_BUDGET = 600;
let targetsVersion = 0;

/** Register all desktop executables at the start of detection so one scan per drive serves every harness. */
export function registerScanTargets(names) {
	let changed = false;
	for (const name of names) {
		const key = lower(name);
		if (key && !scanTargets.has(key)) {
			scanTargets.add(key);
			changed = true;
		}
	}
	if (changed) {
		scanWildcards = [...scanTargets].filter(hasWildcard);
		targetsVersion++;
	}
}

function indexDrive(root) {
	const hit = driveIndex.get(root);
	if (hit && hit.version === targetsVersion && Date.now() - hit.at < SCAN_TTL) return hit.found;
	const found = new Map();
	const started = Date.now();
	const stack = [{ dir: root, depth: 0 }];
	while (stack.length) {
		if (Date.now() - started > SCAN_BUDGET) break;
		const { dir, depth } = stack.pop();
		let items;
		try {
			items = readdirSync(dir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const it of items) {
			if (!it.isFile()) continue;
			const key = lower(it.name);
			const matched = scanTargets.has(key) || scanWildcards.some((p) => matchExeName(key, p));
			if (matched && !found.has(key)) found.set(key, join(dir, it.name));
		}
		if (depth >= 3) continue;
		for (const it of items) {
			if (!it.isDirectory()) continue; // Do not follow symlinks or junctions, avoiding cycles.
			if (SCAN_SKIP.has(lower(it.name))) continue;
			stack.push({ dir: join(dir, it.name), depth: depth + 1 });
		}
	}
	driveIndex.set(root, { at: Date.now(), found, version: targetsVersion });
	return found;
}

/** Find these executables under a drive root via the shared index; return an empty array if absent. */
export function scanDrives(exesRaw, roots) {
	registerScanTargets(exesRaw);
	const out = [];
	for (const root of roots ?? []) {
		const found = indexDrive(root);
		for (const exe of exesRaw) {
			const want = lower(exe);
			if (!hasWildcard(want)) {
				const path = found.get(want);
				if (path) out.push(path);
				continue;
			}
			for (const [name, path] of found) {
				if (matchExeName(name, want)) {
					out.push(path);
					break;
				}
			}
		}
	}
	return out;
}

// Process cache: four desktop apps should not each scan the Start Menu during one refresh.
const shortcutCache = new Map();
const registryCache = new Map();
function shortcutsOf(sources) {
	if (sources.shortcuts) return sources.shortcuts;
	const key = sources.home || "";
	if (!shortcutCache.has(key)) shortcutCache.set(key, shortcutIndex(sources.home));
	return shortcutCache.get(key);
}
function entriesOf(sources, name) {
	if (sources.entries) return sources.entries;
	const key = lower(name);
	if (!registryCache.has(key)) registryCache.set(key, uninstallEntries(name));
	return registryCache.get(key);
}

// ---------- Locate ----------

const lower = (s) => String(s).toLowerCase();

// A macOS desktop app is a `<name>.app` directory, with no Start Menu shortcuts or registry uninstall entries.
// Without this check, installed macOS apps always have install=null and only configuration directory existence remains,
// indistinguishable from configuration left after uninstall.
const macAppRoots = (sources) => {
	if (sources.appDirs) return sources.appDirs;
	if (process.platform !== "darwin") return [];
	const home = sources.home || process.env.HOME;
	return ["/Applications", "/Applications/Utilities", join(home, "Applications")];
};

/** Name must exactly equal `<name>.app`: `Antigravity Tools.app` must not match `Antigravity`. */
function locateAppBundle(namesRaw, sources, findExeIn) {
	for (const name of namesRaw) {
		for (const root of macAppRoots(sources)) {
			const bundle = join(root, `${name}.app`);
			if (!existsSync(bundle) || !isDir(bundle)) continue;
			const macos = join(bundle, "Contents", "MacOS");
			return { dir: bundle, exe: findExeIn(macos) || (existsSync(join(macos, name)) ? join(macos, name) : null), source: "app" };
		}
	}
	return null;
}

/**
 * @param spec {{ names?: string[], exe?: string[], folder?: string[] }}
 *   names  product names (registry display name and shortcut name)
 *   exe    executable names, e.g. WorkBuddy.exe
 *   folder installation directory names, e.g. WorkBuddy
 */
export function locate(spec, sources = defaultSources()) {
	const namesRaw = spec.names ?? [];
	const exesRaw = spec.exe ?? [];
	const foldersRaw = spec.folder ?? spec.names ?? [];
	const names = namesRaw.map(lower);
	const exes = exesRaw.map(lower);
	const folders = foldersRaw.map(lower);
	const isExe = (p) => exes.some((e) => matchExeName(baseOf(p), e));

	const findExeIn = (dir) => {
		for (const pattern of exesRaw) {
			if (!hasWildcard(pattern)) {
				const full = join(dir, pattern);
				if (existsSync(full)) return full;
				continue;
			}
			let items = [];
			try {
				items = readdirSync(dir);
			} catch {
				continue;
			}
			const hit = items.find((name) => matchExeName(name, pattern));
			if (hit) return join(dir, hit);
		}
		return null;
	};

	// 1) Start Menu/desktop shortcuts can point to any drive. Match executable names across the full table first,
	//    so another program with the same prefix, like Antigravity Tools, cannot claim antigravity.
	for (const target of shortcutsOf(sources).values()) {
		if (exes.length && isExe(target)) return { dir: dirOf(target), exe: target, source: "shortcut" };
	}
	for (const [key, target] of shortcutsOf(sources)) {
		if (folders.includes(key) || names.includes(key)) return { dir: dirOf(target), exe: target, source: "shortcut" };
	}

	// 1.5) macOS: `<name>.app` under /Applications indicates installation.
	const bundle = locateAppBundle(namesRaw, sources, findExeIn);
	if (bundle) return bundle;
	// 2) User installation directory and common drive roots: <drive>:, Program Files, Programs, Apps.
	for (const folder of foldersRaw) {
		const guesses = [
			join(sources.roaming, folder),
			join(sources.local, folder),
			join(sources.local, "Programs", folder),
			...(sources.drives ?? []).flatMap((root) => [
				join(root, folder),
				join(root, "Program Files", folder),
				join(root, "Program Files (x86)", folder),
				join(root, "Programs", folder),
				join(root, "Apps", folder),
			]),
		];
		for (const dir of guesses) {
			if (!existsSync(dir) || !isDir(dir)) continue;
			const exe = findExeIn(dir);
			if (exes.length && !exe) continue;
			return { dir, exe, source: "guess" };
		}
	}

	// 3) Registry uninstall entries with InstallLocation / DisplayIcon (slowest, checked last).
	for (const name of spec.names ?? []) {
		for (const e of entriesOf(sources, name)) {
			const icon = e.icon && existsSync(e.icon) && isExe(e.icon) ? e.icon : null;
			const dir = (e.location && existsSync(e.location) && e.location) || (icon ? dirOf(icon) : null);
			if (dir) return { dir, exe: icon, source: "registry" };
		}
	}
	// 3.5) DisplayIcon points to an icon (.ico/.png) rather than an exe: standard for Electron desktop apps
	//      (empty InstallLocation and DisplayIcon inside the installation directory). The icon directory is the install directory.
	//      Icons may also be cached under %SystemRoot%\Installer\{GUID}, so require an actual exe in the directory.
	for (const name of spec.names ?? []) {
		for (const e of entriesOf(sources, name)) {
			if (!e.icon || !existsSync(e.icon) || isExe(e.icon)) continue;
			const dir = dirOf(e.icon);
			if (!existsSync(dir) || !isDir(dir)) continue;
			const exe = findExeIn(dir);
			if (!exe && !firstExeIn(dir)) continue;
			return { dir, exe, source: "registry" };
		}
	}
	// 4) Scan each drive three levels deep for portable or renamed installations without shortcuts.
	if (exes.length && sources.drives?.length) {
		for (const exe of scanDrives(exesRaw, sources.drives)) {
			return { dir: dirOf(exe), exe, source: "scan" };
		}
	}
	return null;
}

function isDir(p) {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/** Any exe in the directory confirms an installation when the registry provides only an icon path. */
function firstExeIn(dir) {
	try {
		const hit = readdirSync(dir).find((name) => /\.exe$/i.test(name));
		return hit ? join(dir, hit) : null;
	} catch {
		return null;
	}
}
