// Automatically detect installed harnesses, their locations, and configuration directories.
// Read only the filesystem and PATH; spawn harnesses for versions only with --versions.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { locate, registerScanTargets } from "./locate.mjs";
import { captureBin, which } from "./spawn.mjs";
import { configHome } from "./paths.mjs";

/**
 * Each host’s signature: executables, configuration roots (including environment overrides), and version command.
 *
 * - bins       command names on PATH
 * - binPaths   common fallback locations when absent from PATH (GUI processes often inherit a PATH missing shell directories)
 * - homes      candidate configuration roots; marker=null means an existing directory counts as installed
 * - marker     string or array; any match counts as installed
 * - configs    user configuration roots separate from install directories (desktop), indicating the app has run
 * - configMarker marker files in the configuration root
 * - apps      desktop install-location hints (shortcuts, registry, drive scan), regardless of drive
 *
 * Read environment variables on every call so tests and refreshes after installation see current values.
 */
export function harnessSpecs() {
	const home = process.env.USERPROFILE || process.env.HOME;
	const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
	const roaming = process.env.APPDATA || join(home, "AppData", "Roaming");
	const win = process.platform === "win32";
	const exe = (name) => (win ? `${name}.exe` : name);

	// Generic fallback: npm/bun/scoop global CLI directories are often absent from a GUI process PATH.
	// List only package-manager locations, not Programs\<name>: executables there are likely desktop apps that --version would launch.
	const commonBins = (names) =>
		names.flatMap((name) => [
			join(roaming, "npm", win ? `${name}.cmd` : name),
			join(home, ".bun", "bin", exe(name)),
			join(home, ".local", "bin", exe(name)),
			join(home, "scoop", "shims", exe(name)),
		]);

	// OpenCode installation methods: official installer (~/.opencode/bin), global bun, global npm, and scoop.
	// These directories are often absent from GUI PATH; relying on PATH alone produces false negatives.
	const opencodeBinPaths = [
		join(home, ".opencode", "bin", exe("opencode")),
		join(home, ".bun", "bin", exe("opencode")),
		join(roaming, "npm", win ? "opencode.cmd" : "opencode"),
		join(local, "Programs", "opencode", exe("opencode")),
		join(home, "scoop", "shims", exe("opencode")),
	];

	// OpenCode now promotes its Electron desktop app: bundle directory ai.opencode.desktop, executable OpenCode.exe.
	// Double-click launches bypass PATH and the CLI locations above. Use only the apps channel, without bin,
	// so --version cannot launch the desktop app. Exact exe matching avoids Uninstall OpenCode.exe.
	const opencodeApps = {
		names: ["OpenCode"],
		exe: ["OpenCode.exe"],
		folder: ["ai.opencode.desktop", "OpenCode", "opencode"],
	};

	return {
		codex: { bins: ["codex"], binPaths: commonBins(["codex"]), homes: [["CODEX_HOME", ".codex"]], version: ["--version"], marker: "config.toml" },
		codebuddy: { bins: ["codebuddy"], binPaths: commonBins(["codebuddy"]), homes: [["CODEBUDDY_HOME", ".codebuddy"]], version: ["--version"], marker: "history.jsonl" },
		claude: { bins: ["claude"], binPaths: commonBins(["claude"]), homes: [["CLAUDE_CONFIG_DIR", ".claude"]], version: ["--version"], marker: "settings.json" },
		opencode: {
			bins: ["opencode"],
			binPaths: opencodeBinPaths,
			apps: opencodeApps,
			homes: [["XDG_CONFIG_HOME", ".config/opencode"]],
			version: ["--version"],
			// Using opencode.json alone would miss users with only jsonc, a login, or a plugin.
			marker: ["opencode.json", "opencode.jsonc", "config.json", "auth.json", "plugins", "node_modules"],
		},
		opencode2: {
			bins: ["opencode2"],
			binPaths: opencodeBinPaths,
			apps: opencodeApps,
			homes: [["XDG_CONFIG_HOME", ".config/opencode"]],
			version: ["--version"],
			marker: ["opencode.json", "opencode.jsonc", "config.json", "auth.json", "plugins", "node_modules"],
		},
		dsh: {
			bins: ["dsh"],
			binPaths: commonBins(["dsh"]),
			homes: [["DSH_HOME", ".dsh"]],
			version: ["--version"],
			marker: "profiles",
			// There are two desktop builds, neither launched through PATH:
			//   Official deepseek-ai/deepseek-harness → productName "DeepSeek Harness"（exe DeepSeek Harness.exe）
			//   anywhere-labs/dsh-desktop dsh-desktop-next (2.0.x-next) → productName "DSH NEXT"，
			//   NSIS shortcutName is also "DSH NEXT"; installed in a user-selected directory (perMachine: false), with executable DSH NEXT.exe.
			apps: {
				names: ["DeepSeek Harness", "DSH", "DSH NEXT"],
				exe: ["DeepSeek Harness.exe", "DSH NEXT.exe"],
				folder: ["DSH", "DeepSeek Harness", "DSH-NEXT", "DSH NEXT"],
			},
		},
		grok: { bins: ["grok"], binPaths: commonBins(["grok"]), homes: [["GROK_HOME", ".grok"]], version: ["--version"], marker: "config.toml" },
		omp: { bins: ["omp"], binPaths: commonBins(["omp"]), homes: [["OMP_HOME", ".omp"]], version: ["--version"], marker: "agent/config.yml" },
		hermes: { bins: ["hermes"], binPaths: commonBins(["hermes"]), homes: [["HERMES_HOME", "AppData/Local/hermes"]], version: ["--version"], marker: "hermes-agent" },
		pi: { bins: ["pi"], binPaths: [...commonBins(["pi"]), join(home, ".pi", "agent", "bin", exe("pi"))], homes: [["PI_HOME", ".pi/agent"]], version: ["--version"], marker: "extensions" },
		zcode: {
			bins: ["zcode"],
			binPaths: [join(local, "Programs", "zcode", exe("ZCode")), join(local, "Programs", "zcode", exe("zcode"))],
			homes: [["ZCODE_HOME", ".zcode"]],
			version: ["--version"],
			marker: "v2/provider_config.json",
			// Closed-source desktop: can be installed anywhere (previously hard-coded to D:/zcode).
			apps: { names: ["ZCode"], exe: ["ZCode.exe"], folder: ["zcode"] },
		},
		qwen: { bins: ["qwen"], binPaths: commonBins(["qwen"]), homes: [["QWEN_HOME", ".qwen"]], version: ["--version"], marker: ["settings.json", "history"] },
		crush: { bins: ["crush"], binPaths: commonBins(["crush"]), homes: [["CRUSH_CONFIG_DIR", ".config/crush"]], version: ["--version"], marker: ["crush.json", "crushrc", "CRUSH.md"] },

		continue: { bins: ["cn", "continue"], binPaths: commonBins(["cn", "continue"]), homes: [["CONTINUE_GLOBAL_DIR", ".continue"]], version: ["--version"], marker: ["config.yaml", "sessions"] },
		qoder: { bins: ["qodercli"], binPaths: commonBins(["qodercli"]), homes: [["QODER_HOME", ".qoder"]], version: ["--version"], marker: ["settings.json", "agents", "sessions"] },
		kimi: { bins: ["kimi"], binPaths: commonBins(["kimi"]), homes: [["KIMI_HOME", ".kimi-code"]], version: ["--version"], marker: ["config.toml", "agents", "sessions"] },
		auggie: { bins: ["auggie"], binPaths: commonBins(["auggie"]), homes: [["AUGGIE_HOME", ".augment"]], version: ["--version"], marker: ["session.json", "settings.json"] },
		goose: { bins: ["goose"], binPaths: commonBins(["goose"]), homes: [["GOOSE_HOME", ".config/goose"]], version: ["--version"], marker: ["config.yaml", "sessions"] },
		kiro: { bins: ["kiro-cli", "kiro"], binPaths: commonBins(["kiro-cli", "kiro"]), homes: [["KIRO_HOME", ".kiro"]], version: ["--version"], marker: ["agents", "settings.json", "config"] },
		kilo: {
			bins: ["kilo", "kilocode"],
			binPaths: commonBins(["kilo", "kilocode"]),
			homes: [["KILO_CONFIG_DIR", ".config/kilo"]],
			version: ["--version"],
			marker: "agent",
		},
		workbuddy: {
			bins: ["WorkBuddy", "workbuddy"],
			homes: [
				["WORKBUDDY_TEMPLATES_DIR", "AppData/Local/Programs/WorkBuddy"],
				["", join(local, "Programs", "WorkBuddy")],
				["", "%ProgramFiles%/WorkBuddy"],
				["", "%ProgramFiles(x86)%/WorkBuddy"],
			],
			// User configuration directory is created when the app runs, independent of install location or layout.
			configs: [["WORKBUDDY_CONFIG_DIR", ".workbuddy"]],
			configMarker: null,
			version: null,
			// The old criterion required workbuddy-prompt.tpl in the package, a relic of template patching;
			// layout changes caused false negatives. An existing installation directory is enough.
			marker: ["WorkBuddy.exe", "resources/app.asar", "resources/app.asar.unpacked"],
			apps: { names: ["WorkBuddy"], exe: ["WorkBuddy.exe"], folder: ["WorkBuddy", "workbuddy"] },
		},
		"workbuddy-ai": {
			bins: ["WorkBuddyAI", "workbuddy-ai", "workbuddyai", "WorkBuddy AI"],
			homes: [
				["WORKBUDDY_AI_TEMPLATES_DIR", "AppData/Local/Programs/WorkBuddyAI"],
				["", join(local, "Programs", "WorkBuddyAI")],
				["", join(local, "Programs", "WorkBuddy AI")],
				["", "%ProgramFiles%/WorkBuddyAI"],
				["", "%ProgramFiles%/WorkBuddy AI"],
				["", "%ProgramFiles(x86)%/WorkBuddyAI"],
				["", "%ProgramFiles(x86)%/WorkBuddy AI"],
			],
			configs: [["WORKBUDDY_AI_CONFIG_DIR", ".workbuddy-ai"]],
			configMarker: null,
			version: null,
			marker: ["WorkBuddyAI.exe", "WorkBuddy AI.exe", "resources/app.asar", "resources/app.asar.unpacked"],
			apps: { names: ["WorkBuddy AI", "WorkBuddyAI"], exe: ["WorkBuddyAI.exe", "WorkBuddy AI.exe"], folder: ["WorkBuddyAI", "WorkBuddy AI", "workbuddy-ai", "workbuddyai"] },
		},
		"pi-desktop": {
			// The desktop app has no CLI entry point; its data root is ~/.pi-desktop (dev: ~/.pi-desktop-dev).
			// Do not use ~/.pi/agent as evidence: it belongs to pi CLI, not PI-Desktop.
			bins: [],
			homes: [["PI_DESKTOP_DATA_DIR", ".pi-desktop"]],
			version: null,
			marker: ["plugins", "pi.sqlite", "secrets"],
			apps: { names: ["PI-Desktop", "PI Desktop"], exe: ["PI-Desktop.exe", "PI-Desktop-Portable*.exe"], folder: ["PI-Desktop", "pi-desktop"] },
		},
		antigravity: {
			// The desktop app and CLI (agy) are separate products: the app is in Programs/Antigravity, CLI in
			// %LOCALAPPDATA%\agy\bin\agy.exe. CLI has --version; the app does not.
			bins: ["agy", "antigravity"],
			binPaths: [join(local, "agy", "bin", exe("agy")), join(home, ".local", "bin", exe("agy"))],
			homes: [["", "Programs/antigravity"]],
			configs: [["AGY_CONFIG_DIR", ".gemini/config"]],
			configMarker: null,
			version: ["--version"],
			marker: ["resources/bin/language_server.exe", "AGENTS.md", "agents", "rules", "skills"],
			apps: { names: ["Antigravity"], exe: ["Antigravity.exe"], folder: ["antigravity"] },
		},
	};
}

function isDir(p) {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function markerList(value) {
	if (value == null) return [null];
	return Array.isArray(value) ? value : [value];
}

function expandRoot([env, rel], home, local) {
	const raw = env && process.env[env] ? process.env[env] : rel;
	// Installation paths often use %ProgramFiles%; an undefined variable is treated as an ordinary root-directory name.
	const expanded = raw.replace(/%([^%]+)%/g, (all, name) => process.env[name] ?? all);
	// Explicit environment values can be absolute paths on any platform; a colon test fails for POSIX.
	if (expanded.startsWith(".") || expanded.startsWith("AppData")) return join(home, expanded);
	return isAbsolute(expanded) ? expanded : join(local, expanded);
}

export function detect({ versions = false } = {}) {
	const path = process.env.PATH || "";
	const home = process.env.USERPROFILE || process.env.HOME;
	const local = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
	const specs = harnessSpecs();
	// Register all desktop exe names for one shared shallow drive scan instead of scanning once per harness.
	registerScanTargets(Object.values(specs).flatMap((spec) => spec.apps?.exe ?? []));
	const out = {};
	for (const [id, spec] of Object.entries(specs)) {
		const bin = which(spec.bins, path) || (spec.binPaths ?? []).find((p) => existsSync(p)) || null;
		const markers = markerList(spec.marker);
		const hit = (root) => markers.some((m) => existsSync(m ? join(root, m) : root));

		const roots = configHome(id) ? [configHome(id)] : spec.homes.map((h) => expandRoot(h, home, local));
		const found = roots.filter(hit);
		// The configuration root itself indicates prior use: a fresh install without marker files should not count as absent.
		const existing = roots.filter(isDir);

		// Desktop: check install and user configuration directories separately; either indicates prior installation.
		const cfgRoots = (spec.configs ?? []).map((h) => expandRoot(h, home, local));
		const cfgMarkers = markerList(spec.configMarker);
		const cfgFound = cfgRoots.filter((r) => cfgMarkers.some((m) => existsSync(m ? join(r, m) : r)));

		// If a desktop app is installed on another drive, its configuration root may also differ: check shortcuts, registry and drives.
		const app = spec.apps ? locate(spec.apps) : null;

		out[id] = {
			id,
			bin,
			version: versions && bin && spec.version ? probe(bin, spec.version) : null,
			home: cfgFound[0] ?? found[0] ?? existing[0] ?? cfgRoots[0] ?? roots[0],
			install: app?.dir ?? null,
			installSource: app?.source ?? null,
			homeExists: found.length > 0 || existing.length > 0 || cfgFound.length > 0,
			// Residual files only: configuration exists, but no executable on PATH, installation directory, or macOS .app.
			// This includes config.toml left after uninstall and skills directories created by other tools; the UI must not show installed.
			residueOnly: Boolean(!bin && !app && (found.length || existing.length || cfgFound.length)),
			found: Boolean(bin || found.length || existing.length || cfgFound.length || app),
		};
	}
	return out;
}

export function probe(bin, args) {
	// Use the spawn bridge for .cmd/.ps1 shims; execFileSync directly on .cmd fails on Windows.
	const out = captureBin(bin, args);
	return out ? out.trim().split("\n")[0].slice(0, 60) : null;
}

// Installed persistent configuration (provided by persist; here only check existence for display).
export function readJsonSafe(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}
