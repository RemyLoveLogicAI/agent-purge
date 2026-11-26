import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { detect } from "../lib/detect.mjs";

// Detection uses only filesystem and PATH; point USERPROFILE / LOCALAPPDATA at the sandbox
// to reproduce false-negative installation checks without real installations.
function sandbox(t) {
	const root = mkdtempSync(join(tmpdir(), "ap-detect-"));
	const home = join(root, "home");
	mkdirSync(home, { recursive: true });
	const saved = {
		USERPROFILE: process.env.USERPROFILE,
		HOME: process.env.HOME,
		LOCALAPPDATA: process.env.LOCALAPPDATA,
		APPDATA: process.env.APPDATA,
		XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
		PATH: process.env.PATH,
		ProgramFiles: process.env.ProgramFiles,
		"ProgramFiles(x86)": process.env["ProgramFiles(x86)"],
		ProgramData: process.env.ProgramData,
		PUBLIC: process.env.PUBLIC,
		AGENT_PURGE_DRIVES: process.env.AGENT_PURGE_DRIVES,
		AGENT_PURGE_APP_DIRS: process.env.AGENT_PURGE_APP_DIRS,
		PI_DESKTOP_DATA_DIR: process.env.PI_DESKTOP_DATA_DIR,
		PI_DESKTOP_AGENT_DIR: process.env.PI_DESKTOP_AGENT_DIR,
	};
	process.env.USERPROFILE = home;
	process.env.HOME = home;
	process.env.LOCALAPPDATA = join(home, "AppData", "Local");
	process.env.APPDATA = join(home, "AppData", "Roaming");
	process.env.XDG_CONFIG_HOME = join(home, ".config");
	process.env.ProgramFiles = join(root, "ProgramFiles");
	process.env["ProgramFiles(x86)"] = join(root, "ProgramFilesX86");
	// Also isolate Start Menu/desktop shortcuts and drives to avoid scanning real installations.
	process.env.ProgramData = join(root, "ProgramData");
	process.env.PUBLIC = join(root, "Public");
	process.env.AGENT_PURGE_DRIVES = join(root, "no-drive");
	process.env.AGENT_PURGE_APP_DIRS = join(root, "no-apps");
	process.env.PATH = "";
	for (const key of ["PI_DESKTOP_DATA_DIR", "PI_DESKTOP_AGENT_DIR"]) delete process.env[key];
	t.after(() => {
		for (const [k, v] of Object.entries(saved)) {
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
		rmSync(root, { recursive: true, force: true });
	});
	return home;
}

test("detect: opencode is detected with only jsonc or a plugins directory", (t) => {
	const home = sandbox(t);
	const cfg = join(home, ".config", "opencode");
	mkdirSync(join(cfg, "plugins"), { recursive: true });
	writeFileSync(join(cfg, "opencode.jsonc"), "{}\n", "utf8");

	const opencode = detect().opencode;
	assert.equal(opencode.found, true);
	assert.equal(opencode.homeExists, true);
	assert.equal(opencode.home, cfg);
	assert.equal(opencode.bin, null, "An empty PATH must not invent a command");
});

test("detect: opencode falls back to common locations when absent from PATH", (t) => {
	const home = sandbox(t);
	const bin = join(home, ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
	mkdirSync(join(home, ".opencode", "bin"), { recursive: true });
	writeFileSync(bin, "", "utf8");

	assert.equal(detect().opencode.found, true);
	assert.equal(detect().opencode.bin, bin);
});

test("detect: opencode is not installed when nothing is present", (t) => {
	sandbox(t);
	assert.equal(detect().opencode.found, false);
	assert.equal(detect().opencode.homeExists, false);
});

test("detect: WorkBuddy is installed even without legacy template files", (t) => {
	const home = sandbox(t);
	const install = join(home, "AppData", "Local", "Programs", "WorkBuddy");
	mkdirSync(join(install, "resources"), { recursive: true });
	writeFileSync(join(install, "WorkBuddy.exe"), "", "utf8");

	const wb = detect().workbuddy;
	assert.equal(wb.found, true, "The old criterion required resources/app.asar.unpacked/.../workbuddy-prompt.tpl and failed after layout changes");
	assert.equal(wb.homeExists, true);
});

test("detect: detect WorkBuddy installed elsewhere by ~/.workbuddy and use that configuration root", (t) => {
	const home = sandbox(t);
	const cfg = join(home, ".workbuddy");
	mkdirSync(cfg, { recursive: true });
	writeFileSync(join(cfg, "settings.json"), "{}\n", "utf8");

	const wb = detect().workbuddy;
	assert.equal(wb.found, true);
	assert.equal(wb.home, cfg);
});

test("detect: WorkBuddy is not installed when absent", (t) => {
	sandbox(t);
	assert.equal(detect().workbuddy.found, false);
	assert.equal(detect().workbuddy.homeExists, false);
});

test("detect: detect WorkBuddy AI international installation directory (WorkBuddyAI.exe)", (t) => {
	const home = sandbox(t);
	const install = join(home, "AppData", "Local", "Programs", "WorkBuddyAI");
	mkdirSync(join(install, "resources"), { recursive: true });
	writeFileSync(join(install, "WorkBuddyAI.exe"), "", "utf8");

	const wbAi = detect()["workbuddy-ai"];
	assert.equal(wbAi.found, true);
	assert.equal(wbAi.homeExists, true);
	assert.equal(detect().workbuddy.found, false, "International edition must not match domestic edition");
});

test("detect: detect WorkBuddy AI international via ~/.workbuddy-ai and use that configuration root", (t) => {
	const home = sandbox(t);
	const cfg = join(home, ".workbuddy-ai");
	mkdirSync(cfg, { recursive: true });
	writeFileSync(join(cfg, "settings.json"), "{}\n", "utf8");

	const wbAi = detect()["workbuddy-ai"];
	assert.equal(wbAi.found, true);
	assert.equal(wbAi.home, cfg);
	assert.equal(detect().workbuddy.found, false, "International configuration root must not match domestic edition");
});

test("detect: drive scan detects desktop installations on F outside default directories", (t) => {
	const home = sandbox(t);
	const root = dirname(home);
	const drive = join(root, "F");
	mkdirSync(join(drive, "WorkBuddy", "resources"), { recursive: true });
	writeFileSync(join(drive, "WorkBuddy", "WorkBuddy.exe"), "", "utf8");
	process.env.AGENT_PURGE_DRIVES = `${drive};`;

	const wb = detect().workbuddy;
	assert.equal(wb.found, true, "Must not rely only on C:/D: default directories");
	assert.equal(wb.install, join(drive, "WorkBuddy"));
});

test("detect: new CLI installation without configuration files is detected by its configuration root", (t) => {
	const home = sandbox(t);
	mkdirSync(join(home, ".claude"), { recursive: true });

	const claude = detect().claude;
	assert.equal(claude.found, true, "A fresh Claude installation without settings.json must not be treated as absent");
	assert.equal(claude.home, join(home, ".claude"));
});

test("detect: PI-Desktop checks its own data root, not pi CLI", (t) => {
	const home = sandbox(t);
	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	assert.equal(detect()["pi-desktop"].found, false, "~/.pi/agent belongs to pi CLI, not PI-Desktop");

	mkdirSync(join(home, ".pi-desktop", "plugins"), { recursive: true });
	assert.equal(detect()["pi-desktop"].found, true);
	assert.equal(detect()["pi-desktop"].home, join(home, ".pi-desktop"));
});

test("detect: uninstalled CLI with only configuration remaining has residueOnly=true", (t) => {
	const home = sandbox(t);
	mkdirSync(join(home, ".grok"), { recursive: true });
	writeFileSync(join(home, ".grok", "config.toml"), "", "utf8");

	const grok = detect().grok;
	assert.equal(grok.found, true, "Configuration directory remains, so found is true");
	assert.equal(grok.residueOnly, true, "No command or install directory remains, only residue");
});

test("detect: an existing command is not residue", (t) => {
	const home = sandbox(t);
	const bin = join(home, ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
	mkdirSync(join(home, ".opencode", "bin"), { recursive: true });
	writeFileSync(bin, "", "utf8");

	assert.equal(detect().opencode.residueOnly, false);
});

test("detect: DSH NEXT desktop installation is not residue only (#24)", (t) => {
	const home = sandbox(t);
	const profile = join(home, ".dsh", "profiles", "desktop");
	mkdirSync(profile, { recursive: true });
	writeFileSync(join(profile, "package.json"), "{}\n", "utf8");
	// anywhere-labs/dsh-desktop dsh-desktop-next uses productName "DSH NEXT" and supports a user-selected NSIS directory.
	const drive = join(dirname(home), "drive");
	const install = join(drive, "DSH-NEXT", "DSH NEXT");
	mkdirSync(install, { recursive: true });
	writeFileSync(join(install, "DSH NEXT.exe"), "", "utf8");
	process.env.AGENT_PURGE_DRIVES = drive;

	const dsh = detect().dsh;
	assert.equal(dsh.install, install);
	assert.equal(dsh.residueOnly, false);
	assert.equal(dsh.found, true);
});

test("detect: absent hosts are neither installed nor residue", (t) => {
	sandbox(t);
	const crush = detect().crush;
	assert.equal(crush.found, false);
	assert.equal(crush.residueOnly, false);
});

test("detect: OpenCode desktop installation is not residue only (#25)", (t) => {
	const home = sandbox(t);
	const cfg = join(home, ".config", "opencode");
	mkdirSync(cfg, { recursive: true });
	writeFileSync(join(cfg, "opencode.jsonc"), "{}\n", "utf8");
	// Electron desktop uses bundle identifier directory ai.opencode.desktop and executable OpenCode.exe;
	// double-click launch bypasses PATH, so CLI-only detection mistakes it for residue.
	const install = join(home, "AppData", "Local", "Programs", "ai.opencode.desktop");
	mkdirSync(install, { recursive: true });
	writeFileSync(join(install, "OpenCode.exe"), "", "utf8");

	const d = detect();
	for (const id of ["opencode", "opencode2"]) {
		assert.equal(d[id].install, install, `${id} must detect the desktop installation directory`);
		assert.equal(d[id].bin, null, "Desktop is not a PATH command; do not invent a bin");
		assert.equal(d[id].residueOnly, false, `${id} has a program binary and is not residue`);
		assert.equal(d[id].found, true);
	}
});

test("detect: an install directory containing only Uninstall OpenCode.exe is not installed (#25)", (t) => {
	const home = sandbox(t);
	const install = join(home, "AppData", "Local", "Programs", "ai.opencode.desktop");
	mkdirSync(install, { recursive: true });
	writeFileSync(join(install, "Uninstall OpenCode.exe"), "", "utf8");

	assert.notEqual(detect().opencode.install, install, "Executable matching must not treat Uninstall OpenCode.exe as the app");
});
