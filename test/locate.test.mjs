import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { locate, readShortcutTarget, scanDrives } from "../lib/locate.mjs";

/** Build a minimal .lnk with Header + LinkInfo(LocalBasePath), sufficient to test the parser. */
function makeLnk(path, target) {
	const header = Buffer.alloc(0x4c);
	header.writeUInt32LE(0x4c, 0);
	header.writeUInt32LE(0x02, 0x14); // HasLinkInfo
	const body = Buffer.from(target, "latin1");
	const info = Buffer.alloc(0x1c);
	info.writeUInt32LE(0x1c + body.length + 1, 0); // LinkInfoSize
	info.writeUInt32LE(0x1c, 4); // LinkInfoHeaderSize
	info.writeUInt32LE(0x01, 8); // VolumeIDAndLocalBasePath
	info.writeUInt32LE(0x1c, 16); // LocalBasePathOffset
	writeFileSync(path, Buffer.concat([header, info, body, Buffer.from([0])]));
}

function sources(extra = {}) {
	// Default appDirs to an empty array to isolate macOS /Applications from real installations.
	return { home: "C:\\Users\\t", local: "C:\\Users\\t\\AppData\\Local", roaming: "C:\\Users\\t\\AppData\\Roaming", drives: [], shortcuts: new Map(), entries: [], appDirs: [], ...extra };
}

test("locate: parse .lnk LocalBasePath on any drive", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-lnk-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const lnk = join(dir, "WorkBuddy.lnk");
	makeLnk(lnk, "F:\\workbuddy\\WorkBuddy.exe");
	assert.equal(readShortcutTarget(lnk), "F:\\workbuddy\\WorkBuddy.exe");
});

test("locate: extract an executable path from binary when LinkInfo is missing", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-lnk-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const lnk = join(dir, "broken.lnk");
	const buf = Buffer.concat([Buffer.from([0x4c, 0, 0, 0]), Buffer.alloc(0x48), Buffer.from("garbage\0F:\\apps\\ZCode\\ZCode.exe\0", "latin1")]);
	writeFileSync(lnk, buf);
	assert.equal(readShortcutTarget(lnk), "F:\\apps\\ZCode\\ZCode.exe");
});

test("locate: locate shortcuts on F rather than only default directories", () => {
	const s = sources({ shortcuts: new Map([["workbuddy", "F:\\workbuddy\\WorkBuddy.exe"]]) });
	const hit = locate({ names: ["WorkBuddy"], exe: ["WorkBuddy.exe"], folder: ["WorkBuddy"] }, s);
	assert.deepEqual(hit, { dir: "F:\\workbuddy", exe: "F:\\workbuddy\\WorkBuddy.exe", source: "shortcut" });
});

test("locate: another program with a shared prefix cannot claim antigravity", () => {
	const s = sources({
		shortcuts: new Map([
			["antigravity tools", "H:\\Antigravity Tools\\antigravity-tools.exe"],
			["antigravity", "C:\\Users\\t\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe"],
		]),
	});
	const hit = locate({ names: ["Antigravity"], exe: ["Antigravity.exe"], folder: ["antigravity"] }, s);
	assert.equal(hit.exe, "C:\\Users\\t\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe");
});

test("locate: scan common drive roots when shortcuts are absent", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-drive-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, "Apps", "WorkBuddy"), { recursive: true });
	writeFileSync(join(dir, "Apps", "WorkBuddy", "WorkBuddy.exe"), "", "utf8");

	const hit = locate({ names: ["WorkBuddy"], exe: ["WorkBuddy.exe"], folder: ["WorkBuddy"] }, sources({ drives: [dir] }));
	assert.equal(hit.dir, join(dir, "Apps", "WorkBuddy"));
	assert.equal(hit.source, "guess");
});

test("locate: fall back to registry uninstall entries", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-reg-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeFileSync(join(dir, "WorkBuddy.exe"), "", "utf8");

	const hit = locate(
		{ names: ["WorkBuddy"], exe: ["WorkBuddy.exe"], folder: ["WorkBuddy"] },
		sources({ entries: [{ name: "WorkBuddy 5.9.3", location: dir, icon: join(dir, "WorkBuddy.exe") }] }),
	);
	assert.equal(hit.dir, dir);
	assert.equal(hit.source, "registry");
});


// #24：Electron desktop uninstall entries often have empty InstallLocation and DisplayIcon pointing to an .ico.
// Old logic accepted only exe DisplayIcons, skipping such installs and leaving only configuration directory evidence.
test("locate: detect installation from icon directory when only DisplayIcon is set (#24)", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-reg-icon-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeFileSync(join(dir, "Acme Desktop.exe"), "", "utf8");
	writeFileSync(join(dir, "uninstallerIcon.ico"), "", "utf8");

	const hit = locate(
		{ names: ["Acme"], exe: ["Acme Desktop.exe"], folder: ["Acme"] },
		sources({ entries: [{ name: "Acme Desktop 2.0.23", location: "", icon: join(dir, "uninstallerIcon.ico") }] }),
	);
	assert.equal(hit.dir, dir);
	assert.equal(hit.exe, join(dir, "Acme Desktop.exe"));
	assert.equal(hit.source, "registry");
});

test("locate: recognize icon directory when exe name differs, but leave exe empty", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-reg-icon3-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeFileSync(join(dir, "Renamed Build.exe"), "", "utf8");
	writeFileSync(join(dir, "uninstallerIcon.ico"), "", "utf8");

	const hit = locate(
		{ names: ["Acme"], exe: ["Acme Desktop.exe"], folder: ["Acme"] },
		sources({ entries: [{ name: "Acme Desktop 2.0.23", location: "", icon: join(dir, "uninstallerIcon.ico") }] }),
	);
	assert.equal(hit.dir, dir);
	assert.equal(hit.exe, null);
});

test("locate: do not treat an icon directory without an exe as an installation", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-reg-icon2-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	writeFileSync(join(dir, "productIcon.ico"), "", "utf8");

	const hit = locate(
		{ names: ["Acme"], exe: ["Acme Desktop.exe"], folder: ["Acme"] },
		sources({ entries: [{ name: "Acme Desktop 2.0.23", location: "", icon: join(dir, "productIcon.ico") }] }),
	);
	assert.equal(hit, null);
});
test("locate: shallow drive scan finds nonstandard directories without shortcuts", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-scan-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const deep = join(dir, "Green", "WorkBuddy2");
	mkdirSync(deep, { recursive: true });
	writeFileSync(join(deep, "WorkBuddy.exe"), "", "utf8");

	const hit = locate({ names: ["WorkBuddy"], exe: ["WorkBuddy.exe"], folder: ["WorkBuddy"] }, sources({ drives: [dir] }));
	assert.equal(hit.dir, deep);
	assert.equal(hit.source, "scan");
});

test("scanDrives: skip system directories and return empty when absent", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-scan2-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, "Windows", "Sys"), { recursive: true });
	writeFileSync(join(dir, "Windows", "Sys", "WorkBuddy.exe"), "", "utf8");
	assert.deepEqual(scanDrives(["WorkBuddy.exe"], [dir]), []);
});

test("fixedDrives: skip mapped network drives (disconnected drives block until SMB timeout, #22)", async () => {
	const { localDriveRoots, mappedDriveLetters } = await import("../lib/locate.mjs");
	// Real reg query HKCU\Network structure: subkey names are drive letters and values are one level down.
	const regOut = [
		"HKEY_CURRENT_USER\\Network\\Z",
		"    ConnectionType    REG_DWORD    0x1",
		"    RemotePath    REG_SZ    \\\\nas\\share",
		"HKEY_CURRENT_USER\\Network\\y",
	].join("\r\n");
	assert.deepEqual([...mappedDriveLetters(regOut)].sort(), ["Y", "Z"]);
	assert.deepEqual([...mappedDriveLetters("")], [], "No drive letters should be detected without HKCU\\Network");

	// Exclude network drives before existsSync to avoid blocking the process until SMB timeout.
	const asked = [];
	const list = localDriveRoots({
		network: new Set(["X", "Y", "Z"]),
		slow: new Set(),
		probe: (root) => {
			asked.push(root);
			return root === "C:\\" || root === "X:\\";
		},
	});
	assert.deepEqual(list, ["C:\\"]);
	for (const letter of ["X", "Y", "Z"]) assert.ok(!asked.includes(`${letter}:\\`), `${letter}: must not be passed to existsSync`);
	assert.equal(asked.length, 21, "Remaining local drives must still be probed individually");

	// Session mappings absent from the registry (net use /persistent:no) still time out on first probe;
	// after measuring a nonlocal drive, subsequent scans and cache refreshes must not block again.
	const slow = new Set();
	const askedSlow = [];
	const firstSlow = localDriveRoots({
		network: new Set(),
		slow,
		slowAfterMs: 0,
		probe: (root) => {
			askedSlow.push(root);
			return root === "C:\\";
		},
	});
	assert.equal(slow.size, 24, "Record drives exceeding the time threshold");
	assert.deepEqual(firstSlow, ["C:\\"]);
	assert.deepEqual(
		localDriveRoots({ network: new Set(), slow, slowAfterMs: 0, probe: (root) => { askedSlow.push(root); return true; } }),
		[],
		"Known slow drives are excluded from the next scan",
	);
	assert.equal(askedSlow.length, 24, "No drives should be probed again in the second scan");
});

test("fixedDrives: list local drives normally despite network-drive filtering", { skip: process.platform !== "win32" }, async (t) => {
	const { fixedDrives } = await import("../lib/locate.mjs");
	const saved = process.env.AGENT_PURGE_DRIVES;
	delete process.env.AGENT_PURGE_DRIVES;
	t.after(() => {
		if (saved === undefined) delete process.env.AGENT_PURGE_DRIVES;
		else process.env.AGENT_PURGE_DRIVES = saved;
	});
	const sys = `${process.env.SystemDrive || "C:"}\\`;
	assert.ok(fixedDrives().includes(sys), `Should list system drive ${sys}`);
});

test("locate: return null when nothing is found", () => {
	assert.equal(locate({ names: ["Nope"], exe: ["Nope.exe"], folder: ["Nope"] }, sources()), null);
});

test("locate: recognize versioned portable executables (PI-Desktop-Portable-0.21.0.exe)", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-portable-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const deep = join(dir, "Vivaldi");
	mkdirSync(deep, { recursive: true });
	writeFileSync(join(deep, "PI-Desktop-Portable-0.21.0.exe"), "", "utf8");

	const hit = locate(
		{ names: ["PI-Desktop"], exe: ["PI-Desktop.exe", "PI-Desktop-Portable*.exe"], folder: ["PI-Desktop"] },
		sources({ drives: [dir] }),
	);
	assert.equal(hit.dir, deep);
	assert.equal(hit.exe, join(deep, "PI-Desktop-Portable-0.21.0.exe"));
	assert.equal(hit.source, "scan");
});

test("matchExeName: wildcards require explicit *, and antigravity-tools does not match Antigravity.exe", async () => {
	const { matchExeName } = await import("../lib/locate.mjs");
	assert.equal(matchExeName("PI-Desktop-Portable-0.21.0.exe", "PI-Desktop-Portable*.exe"), true);
	assert.equal(matchExeName("antigravity-tools.exe", "Antigravity.exe"), false);
});

test("locate: decode .lnk ANSI paths with the system code page, including non-ASCII directories", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-lnk-cjk-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const lnk = join(dir, "WorkBuddy AI.lnk");
	// The non-ASCII segment of the WorkBuddyAI path is GBK encoded.
	const gbk = Buffer.from([
		0x44, 0x3a, 0x5c, 0x57, 0x6f, 0x72, 0x6b, 0x42, 0x75, 0x64, 0x64, 0x79, // D:\WorkBuddy
		0xb9, 0xfa, 0xbc, 0xca, 0xb0, 0xe6, // International edition (GBK)
		0x5c, 0x57, 0x6f, 0x72, 0x6b, 0x42, 0x75, 0x64, 0x64, 0x79, 0x41, 0x49, // \WorkBuddyAI
		0x5c, 0x57, 0x6f, 0x72, 0x6b, 0x42, 0x75, 0x64, 0x64, 0x79, 0x41, 0x49, 0x2e, 0x65, 0x78, 0x65, // \WorkBuddyAI.exe
	]);
	const header = Buffer.alloc(0x4c);
	header.writeUInt32LE(0x4c, 0);
	header.writeUInt32LE(0x02, 0x14);
	const info = Buffer.alloc(0x1c);
	info.writeUInt32LE(0x1c + gbk.length + 1, 0);
	info.writeUInt32LE(0x1c, 4);
	info.writeUInt32LE(0x01, 8);
	info.writeUInt32LE(0x1c, 16);
	writeFileSync(lnk, Buffer.concat([header, info, gbk, Buffer.from([0])]));

	const parsed = readShortcutTarget(lnk);
	assert.ok(parsed && parsed.endsWith("WorkBuddyAI.exe"), `Should detect executable: ${parsed}`);
	// Decoding depends on the local ANSI code page: code page 936 must decode Chinese correctly; on CI machines using 1252,
	// GBK bytes would not normally occur in a real .lnk, so latin1 fallback is acceptable.
	if (process.platform === "win32" && ansiCodePage() === "936") {
		assert.match(parsed, /WorkBuddy\u56fd\u9645\u7248/, `Code page 936 must decode correctly: ${parsed}`);
	}
	// Other code pages are not expected to decode the Chinese text; do not assert it.
});

/** Local ANSI code page; return an empty string if unavailable (caller does not enforce). */
function ansiCodePage() {
	if (process.platform !== "win32") return "";
	try {
		const out = execFileSync("reg", ["query", String.raw`HKLM\SYSTEM\CurrentControlSet\Control\Nls\CodePage`, "/v", "ACP"], {
			encoding: "utf8",
			windowsHide: true,
		});
		return out.match(/ACP\s+REG_SZ\s+([0-9]+)/)?.[1] ?? "";
	} catch {
		return "";
	}
}

test("locate: macOS /Applications/<name>.app indicates installation", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-app-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const bundle = join(dir, "PI-Desktop.app");
	mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
	writeFileSync(join(bundle, "Contents", "MacOS", "PI-Desktop"), "", "utf8");

	const hit = locate({ names: ["PI-Desktop"], exe: ["PI-Desktop.exe"], folder: ["PI-Desktop"] }, sources({ appDirs: [dir] }));
	assert.equal(hit.dir, bundle);
	assert.equal(hit.exe, join(bundle, "Contents", "MacOS", "PI-Desktop"));
	assert.equal(hit.source, "app");
});

test("locate: .app name must match exactly; Antigravity Tools.app does not match Antigravity", (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-app2-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, "Antigravity Tools.app", "Contents", "MacOS"), { recursive: true });

	const hit = locate({ names: ["Antigravity"], exe: ["Antigravity.exe"], folder: ["antigravity"] }, sources({ appDirs: [dir] }));
	assert.equal(hit, null);
});
