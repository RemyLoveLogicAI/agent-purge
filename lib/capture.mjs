// Evidence chain: run the real binary → local mock provider → inspect what it sends to the model.
// Do not trust harness self-reports or constants in matrix.json here; use captured request bodies only.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { spawnBin, resolveBin } from "./spawn.mjs";
import { isolatedEnv } from "./environment.mjs";
import { isCompiled } from "./root.mjs";
import { antigravityBin } from "./antigravity.mjs";
export { isolatedEnv } from "./environment.mjs";
import { inspectRequest, requestKind, startCaptureProvider } from "../bench/capture-provider.mjs";
import { writeVerification } from "../bench/capture-report.mjs";

// Goose installed by winget is not on PATH; check the fixed location before falling back to PATH.
export function gooseBin() {
	if (process.platform !== "win32") return resolveBin("goose");
	const base = join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages");
	try {
		for (const dir of readdirSync(base)) {
			if (!dir.toLowerCase().startsWith("agenticai")) continue;
			const hit = findFile(join(base, dir), "goose.exe");
			if (hit) return hit;
		}
	} catch {
		/* Fall back to PATH if the winget directory is absent */
	}
	return resolveBin("goose");
}

function findFile(dir, name, depth = 0) {
	if (depth > 4) return null;
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return null;
	}
	for (const e of entries) if (e.isFile() && e.name.toLowerCase() === name) return join(dir, e.name);
	for (const e of entries) {
		if (!e.isDirectory()) continue;
		const hit = findFile(join(dir, e.name), name, depth + 1);
		if (hit) return hit;
	}
	return null;
}

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "..", "bin", "agent-purge.mjs");

// The isolated HOME is temporary scaffolding: evidence goes to out/, and temporary trees must not accumulate.
const ISOLATED_ROOTS = [];
export function trackRoot(root) {
	ISOLATED_ROOTS.push(root);
	return root;
}

export function cleanupRoots() {
	if (process.env.AP_KEEP_ROOTS || process.argv.includes("--keep-roots")) return;
	for (const root of ISOLATED_ROOTS.splice(0)) {
		// Do not use rm -rf, which Windows lacks; Node retry deletion works on both platforms.
		try {
			rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		} catch {
			/* Failure to delete a temporary directory does not affect the evidence */
		}
	}
}

export function agentCommand(args) { return { cmd: process.execPath, args: isCompiled() ? args : [CLI, ...args] }; }

export function captureOutcome(result, requests, mode) {
	const detail = String(result.error || result.stderr || result.stdout || "").trim().slice(-1800);
	if (result.timedOut) return { status: "error", reason: `Harness timed out${detail ? `: ${detail}` : ""}` };
	if (!requests.length) {
		if (result.error || result.code !== 0) return { status: "error", reason: `Harness did not exit normally (exit code ${result.code ?? "unknown"})${detail ? `: ${detail}` : ""}` };
		return { status: "no-request", reason: "The harness exited, but no main request was captured; this does not establish whether the persona took effect." };
	}
	// Evaluate all main requests: a host may first send an auxiliary main request (Gemini complexity classification or Qwen memory extraction),
	// whose host system prompt should not cause persona injection to fail; one main request with exactly one persona suffices.
	const hits = requests.filter((request) => request.markerCount === 1).length;
	// Double injection is a real bug; no main request may contain duplicate injection.
	if (requests.some((request) => request.markerCount > 1))
		return { status: "mismatch", reason: "The persona appeared more than once in a main request and may have been injected repeatedly." };
	if (mode === "off") {
		if (hits > 0) return { status: "mismatch", reason: "The persona still appeared in a main request in off mode, so the injection was not bypassed." };
	} else if (hits === 0) {
		return { status: "mismatch", reason: "No main request contained the persona; injection did not take effect." };
	}
	// If the request body and persona location are correct but the exit code is nonzero, this is a host teardown issue
	// (Qwen / Gemini can hit the libuv UV_HANDLE_CLOSING assertion on Windows + Node 24),
	// which does not invalidate evidence about the request body. Record it honestly rather than claiming a clean exit.
	if (result.error || result.code !== 0) {
		return {
			status: "captured",
			teardown: `Exit code ${result.code ?? "unknown"} (host crashed during teardown; request body was captured in full)`,
			reason: null,
		};
	}
	return { status: "captured", reason: null };
}

async function prepareCapture(harness, bin, env, cwd, out, timeout, mode = "off") {
	if (harness === "crush" && mode !== "off") {
		// Crush personas use only the install channel (a CRUSH.md managed block); without installation they will not appear in requests.
		// The isolated HOME is deleted after use, so uninstall is unnecessary.
		const command = agentCommand(["install", harness]);
		const r = await runProcess(command.cmd, command.args, { env, cwd, timeout });
		if (out) put(join(out, harness, "prepare.process.json"), r);
		if (r.error || r.timedOut || r.code !== 0)
			throw new Error("Could not install the crush managed block in the isolated HOME: " + (r.error || r.stderr || `exit ${r.code}`));
		// The installer writes one location; Crush reads different locations depending on platform, so populate all four candidates.
		const source = join(env.XDG_CONFIG_HOME, "crush", "CRUSH.md");
		if (existsSync(source)) {
			const body = readFileSync(source, "utf8");
			for (const dir of [join(env.USERPROFILE, ".config"), env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.APPDATA]) {
				if (dir) put(join(dir, "crush", "CRUSH.md"), body);
			}
		}
	}
	if (harness !== "dsh") return;
	// Single-mode verification used to fail in a fresh HOME: only the first
	// `off` run in the four-mode benchmark happened to initialize this profile.
	const result = await runProcess(bin, ["--profile", "headless", "--dump-config"], { env, cwd, timeout });
	if (out) put(join(out, harness, "prepare.process.json"), result);
	if (result.error || result.timedOut || result.code !== 0)
		throw new Error("Could not initialize the isolated DSH headless profile: " + (result.error || result.stderr || `exit ${result.code}`));
}

export function runProcess(cmd, args, { env, cwd, timeout = 35000, input } = {}) {
	return new Promise((done) => {
		let child;
		try {
			child = spawnBin(cmd, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
		} catch (e) {
			done({ code: null, error: e.message, stdout: "", stderr: "" });
			return;
		}
		let stdout = "",
			stderr = "",
			timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
			else child.kill("SIGKILL");
		}, timeout);
		child.stdout.on("data", (b) => (stdout = (stdout + b).slice(-100000)));
		child.stderr.on("data", (b) => (stderr = (stderr + b).slice(-100000)));
		child.on("error", (e) => {
			clearTimeout(timer);
			done({ code: null, error: e.message, stdout, stderr });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			done({ code, timedOut, stdout, stderr });
		});
		// Close stdin only when actually providing input. Unconditionally calling end() causes Node CLIs such as Qwen / Gemini to hit
		// the libuv UV_HANDLE_CLOSING assertion on exit (Windows + Node 24), making a completed
		// capture look like a failure. With no input, let it read EOF itself.
		if (input !== undefined) child.stdin.end(input);
		else child.stdin.on("error", () => {});
	});
}

export function put(file, content) {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

export function seed(env, harness, mode, body) {
	const root = env.AGENT_PURGE_HOME;
	put(join(root, "personas", "capture-a.md"), body);
	put(join(root, "personas", "active.md"), body);
	put(join(root, "state.json"), { v: 1, persona: "capture-a", default: { harness, mode }, armed: {}, piAuto: false, ompAuto: false });
}

export function configure(h, env, url, cwd) {
	// Point ordinary proxy variables to the same loopback server to prevent child processes from silently using the real network.
	Object.assign(env, {
		HTTP_PROXY: url,
		HTTPS_PROXY: url,
		ALL_PROXY: url,
		NO_PROXY: "127.0.0.1,localhost",
		ANTHROPIC_BASE_URL: url,
		ANTHROPIC_API_KEY: "capture-fixture-key",
		OPENAI_BASE_URL: url + "/v1",
		OPENAI_API_KEY: "capture-fixture-key",
	});
	const model = {
		id: "capture",
		name: "Capture fixture",
		reasoning: false,
		input: ["text"],
		contextWindow: 128000,
		maxTokens: 2048,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	};
	const providers = { capture: { baseUrl: url + "/v1", api: "openai-completions", apiKey: "capture-fixture-key", models: [model] } };
	if (h === "pi") {
		put(join(env.PI_CODING_AGENT_DIR, "models.json"), { providers });
		put(join(env.PI_CODING_AGENT_DIR, "settings.json"), { packages: [], mcp: { servers: {} } });
		return ["--provider", "capture", "--model", "capture", "--no-mcp", "--no-skills", "--no-context-files", "--no-prompt-templates", "--no-session"];
	}
	if (h === "omp") {
		env.PI_CODING_AGENT_DIR = join(env.OMP_HOME, "agent");
		put(join(env.PI_CODING_AGENT_DIR, "models.yml"), JSON.stringify({ providers }));
		return ["--provider", "capture", "--model", "capture", "--no-extensions", "--no-skills", "--no-rules", "--no-context-files", "--no-lsp", "--no-title", "--no-session"];
	}
	if (h === "claude") return ["--model", "claude-sonnet-4-5", "--max-turns", "1", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--setting-sources", ""];
	if (h === "codex") {
		put(
			join(env.CODEX_HOME, "config.toml"),
			`model = "gpt-5.4"\nmodel_provider = "capture"\n[model_providers.capture]\nname = "Capture"\nbase_url = "${url}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`,
		);
		return ["--skip-git-repo-check", "--ephemeral"];
	}
	if (h === "opencode") {
		put(join(cwd, "opencode.json"), {
			model: "capture/capture",
			small_model: "capture/capture",
			provider: { capture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: url + "/v1", apiKey: "capture-fixture-key" }, models: { capture: { name: "Capture", limit: { context: 128000, output: 2048 } } } } },
		});
		return ["--model", "capture/capture"];
	}
	if (h === "antigravity") {
		// agy accepts a real GEMINI_API_KEY only when settings.json sets modelProvider=gemini;
		// otherwise it uses account OAuth (capture has no credentials). Point GOOGLE_GEMINI_BASE_URL to loopback.
		put(join(env.USERPROFILE, ".gemini", "antigravity-cli", "settings.json"), { modelProvider: "gemini" });
		Object.assign(env, { GEMINI_API_KEY: "capture-fixture-key", GOOGLE_GEMINI_BASE_URL: url, AGY_CLI_DISABLE_AUTO_UPDATE: "1" });
		// Do not pass --model: the built-in model list is fetched by region and unavailable in isolated HOME; the default tier picks a known model.
		return [];
	}
	if (h === "kilo") {
		put(join(cwd, "kilo.json"), {
			model: "capture/capture",
			provider: { capture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: url + "/v1", apiKey: "capture-fixture-key" }, models: { capture: { name: "Capture" } } } },
		});
		return ["--model", "capture/capture", "--format", "json"];
	}
	if (h === "dsh") {
		Object.assign(env, { DEEPSEEK_BASE_URL: url, DEEPSEEK_API_KEY: "capture-fixture-key", DSH_TELEMETRY_MODE: "DISABLED", DSH_TELEMETRY_OTLP_URL: url + "/telemetry" });
		return [];
	}
	if (h === "codebuddy") {
		Object.assign(env, {
			CODEBUDDY_BASE_URL: url,
			CODEBUDDY_API_KEY: "capture-fixture-key",
			CODEBUDDY_MODEL: "capture",
			CODEBUDDY_SMALL_FAST_MODEL: "capture",
			CODEBUDDY_BIG_SLOW_MODEL: "capture",
		});
		return ["--model", "capture", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--no-session-persistence", "--setting-sources", ""];
	}
	if (h === "grok") {
		Object.assign(env, { XAI_API_KEY: "capture-fixture-key", GROK_XAI_API_BASE_URL: url + "/v1", GROK_MODELS_BASE_URL: url + "/v1", GROK_DISABLE_AUTOUPDATER: "1" });
		put(
			join(env.GROK_HOME, "config.toml"),
			`[model.capture]\nmodel = "capture"\nbase_url = "${url}/v1"\nenv_key = "XAI_API_KEY"\napi_backend = "chat_completions"\n[models]\ndefault = "capture"\n`,
		);
		return ["--model", "capture", "--max-turns", "1", "--disable-web-search", "--no-subagents"];
	}
	if (h === "opencode2") {
		put(join(cwd, "opencode.json"), {
			model: "capture/capture",
			providers: { capture: { package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: url + "/v1", apiKey: "capture-fixture-key" }, models: { capture: { name: "Capture" } } } },
		});
		return ["--standalone", "--model", "capture/capture"];
	}
	// Qwen Code：Use official --openai-base-url / --auth-type openai; any model name recognized by the provider works.
	if (h === "qwen") {
		Object.assign(env, { OPENAI_API_KEY: "capture-fixture-key", OPENAI_BASE_URL: url + "/v1", OPENAI_MODEL: "capture" });
		return ["--auth-type", "openai", "--openai-api-key", "capture-fixture-key", "--openai-base-url", url + "/v1", "--model", "capture"];
	}
	// Kimi Code：Define an OpenAI-type provider in config.toml and point default_model to it.
	if (h === "kimi") {
		put(
			join(env.USERPROFILE, ".kimi-code", "config.toml"),
			`default_model = "capture/capture"\n\n[providers.capture]\nbase_url = "${url}/v1"\ntype = "openai"\napi_key = "capture-fixture-key"\n\n[models."capture/capture"]\nprovider = "capture"\nmodel = "capture"\nmax_context_size = 128000\nmax_output_size = 2048\ncapabilities = [ "tool_use" ]\ndisplay_name = "Capture"\n`,
		);
		return [];
	}
	// Qoder CLI：settings.json providers support openai-compatible; useExternal skips account login.
	// Three schema pitfalls: models[] uses model, not id; the default model is top-level model.name;
	// an extra unknown top-level key rejects the entire settings file and falls back to not logged in.
	if (h === "qoder") {
		put(join(env.USERPROFILE, ".qoder", "settings.json"), {
			security: { auth: { useExternal: true } },
			model: { name: "capture/capture" },
			providers: {
				capture: {
					type: "openai-compatible",
					protocol: "openai",
					authType: "api-key",
					baseUrl: url + "/v1",
					apiKey: "capture-fixture-key",
					models: [{ model: "capture", displayName: "Capture" }],
				},
			},
		});
		return [];
	}
	// Continue CLI：CONTINUE_GLOBAL_DIR sets the configuration directory; provide an OpenAI-compatible model in config.yaml.
	if (h === "continue") {
		env.CONTINUE_GLOBAL_DIR = join(env.USERPROFILE, ".continue");
		put(
			join(env.CONTINUE_GLOBAL_DIR, "config.yaml"),
			`name: capture\nversion: 1.0.0\nschema: v1\nmodels:\n  - name: capture\n    provider: openai\n    model: capture\n    apiBase: ${url}/v1\n    apiKey: capture-fixture-key\n    roles: [chat, edit, apply]\n`,
		);
		return [];
	}
	// Goose：GOOSE_PROVIDER=openai + OPENAI_HOST points to loopback; the binary is in the WinGet directory, not PATH.
	if (h === "goose") {
		const dir = dirname(gooseBin());
		env.PATH = dir + (process.platform === "win32" ? ";" : ":") + env.PATH;
		Object.assign(env, {
			GOOSE_PROVIDER: "openai",
			GOOSE_MODEL: "capture",
			OPENAI_HOST: url,
			OPENAI_BASE_PATH: "v1/chat/completions",
			OPENAI_API_KEY: "capture-fixture-key",
			GOOSE_DISABLE_KEYRING: "1",
			GOOSE_MODE: "auto",
		});
		return [];
	}
	// Auggie：has no base-url option, but login state is JSON with {accessToken, tenantURL, scopes};
	// AUGMENT_SESSION_AUTH accepts this directly; pointing tenantURL to loopback avoids OAuth.
	// scopes must be an array; an empty array is treated as an invalid session.
	if (h === "auggie") {
		Object.assign(env, {
			AUGMENT_SESSION_AUTH: JSON.stringify({ accessToken: "capture-fixture-token", tenantURL: url, scopes: ["read"] }),
			AUGMENT_DISABLE_AUTO_UPDATE: "1",
		});
		// When tenantURL already points to loopback, adding HTTP_PROXY makes undici treat the request as proxying a real domain,
		// which loopback rejects with 403. Clear proxy variables for this host.
		for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key];
		return [];
	}
// Crush：The JSON configuration is crush.json (crushrc is a different shell-style format and cannot parse JSON).
	// It looks in $XDG_CONFIG_HOME/crush/crush.json and $XDG_DATA_HOME/crush/crush.json.
	if (h === "crush") {
		// Without TERM, Bubble Tea asks for terminal dimensions and hangs without a TTY; explicitly set dumb and CI.
		// Crush is written in Go and reads HTTP_PROXY; with base_url already pointing to loopback,
		// adding a proxy makes it proxy a real domain, blocked by loopback with 403 (the cause of zero requests).
		for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) delete env[key];
		// Without TERM, Bubble Tea asks for terminal dimensions and hangs without a TTY; explicitly set dumb and CI.
		Object.assign(env, { TERM: "dumb", CI: "1" });
		const config = {
			$schema: "https://charm.land/crush.json",
			providers: { capture: { type: "openai", name: "Capture", base_url: url + "/v1", api_key: "capture-fixture-key", models: [{ id: "capture", name: "capture" }] } },
			models: { large: { provider: "capture", model: "capture" }, small: { provider: "capture", model: "capture" } },
		};
		// On Windows it actually reads %USERPROFILE%\.config\crush\crush.json (XDG is the documented path),
		// so write all four candidate directories instead of guessing.
		for (const dir of [join(env.USERPROFILE, ".config"), env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.APPDATA]) {
			if (dir) put(join(dir, "crush", "crush.json"), config);
		}
		return [];
	}
	return null;
}


/** One capture: install a seed persona → run one real request → analyze which layer contains the marker. */
// Map hosts whose harness and executable names differ here (Antigravity CLI is agy).
function resolveHarnessBin(h) {
	if (h === "antigravity") {
		const bin = antigravityBin();
		return bin && bin !== "agy" ? bin : resolveBin("agy");
	}
	if (h === "goose") return gooseBin();
	// Hosts whose harness and executable names differ
	if (h === "qoder") return resolveBin("qodercli");
	if (h === "continue") return resolveBin("cn");
	return resolveBin(h);
}

export async function captureMode(h, { out, mode = "replace", timeout = 45000 } = {}) {
	const bin = resolveHarnessBin(h);
	if (!bin) return { harness: h, mode, status: "missing", reason: "Executable not found" };
	const root = trackRoot(mkdtempSync(join(tmpdir(), `ap-capture-${h}-`)));
	const env = isolatedEnv(root);
	const cwd = join(root, "work");
	mkdirSync(cwd);
	env.AGENT_PURGE_REAL_BIN = bin;
	const version = await runProcess(bin, ["--version"], { env, cwd, timeout: 12000 });
	const base = { harness: h, mode, executable: bin, version: version.stdout.trim(),
		scope: { kind: "isolated-cli", profile: h === "dsh" ? "headless" : null, syntheticPersona: true, currentSession: false } };
	if (h === "hermes") return { ...base, status: "blocked", reason: (version.stderr || version.stdout).trim() || "No isolated provider adapter" };

	const provider = await startCaptureProvider(join(out ?? root, h, "requests"));
	let flags;
	try {
		flags = configure(h, env, provider.url, cwd);
		if (flags) await prepareCapture(h, bin, env, cwd, out, timeout, mode);
	} catch (e) {
		await provider.close();
		return { ...base, status: "error", reason: e.message };
	}
	if (!flags) {
		await provider.close();
		return { ...base, status: "blocked", reason: "Provider/isolation adapter not yet verified for this executable" };
	}
	try {
		const marker = `AP_CAPTURE_${h}_${mode}_${randomUUID()}`;
		const body = `Capture-only neutral persona. Marker: ${marker}. Reply briefly.`;
		seed(env, h, mode, body);
		const start = provider.captures.length;
		const command = agentCommand([h, "--ask", "Reply CAPTURE_OK.", "--", ...flags]);
		// Crush waits for stdin without a TTY; empty input gives it immediate EOF.
		const result = await runProcess(command.cmd, command.args, { env, cwd, timeout, input: h === "crush" ? "" : undefined });
		const processFile = join(out ?? root, h, mode + ".process.json");
		put(processFile, result);
		const analyses = provider.captures.slice(start).map((r) => ({ id: r.id, protocol: r.protocol, kind: requestKind(r.body), ...inspectRequest(r.body, marker) }));
		// Unknown and auxiliary requests are still evidence but cannot replace the main turn.
		const checks = analyses.filter((a) => a.kind === "main");
		const hit = checks.find((a) => a.markerCount > 0);
		return {
			...base,
			...captureOutcome(result, checks, mode),
			processFile,
			exitCode: result.code,
			timedOut: result.timedOut,
			marker,
			// Injection layer: inspectRequest text/markerCount counts only privileged roles (system/developer),
			// while user-message hits are given separately by userMarkerCount; together they identify the injection layer.
			injected: { sys: Boolean(hit), user: checks.some(request => request.userMarkerCount > 0) },
			chars: hit?.chars ?? 0,
			head: (hit?.text ?? "").slice(0, 200),
			requests: analyses.map(({ text: _text, ...a }) => a),
		};
	} finally {
		await provider.close();
	}
}

/** verify: capture the current mode once and write verification/latest.json for the Web UI.
 * Do not write raw prompt text (that belongs in local capture files): the summary contains only roles, character counts and marker hits. */
export async function verifyHarnesses(harnesses, { root, timeout, mode = "replace" } = {}) {
	const at = new Date().toISOString();
	const out = join(root, "verification", at.replace(/[:.]/g, "-"));
	const report = {
		schema: 1,
		at,
		kind: "loopback-real-binary",
		out,
		limitations: ["Only proves the persona was present in the request body, not the quality of model behavior", "A loopback mock provider is not an OS-level network sandbox"],
		harnesses: [],
	};
	for (const h of harnesses) {
		let r;
		try {
			r = await captureMode(h, { out, mode, timeout });
		} catch (e) {
			r = { harness: h, status: "error", reason: e.message };
		}
		report.harnesses.push({
			harness: h,
			executable: r.executable ?? null,
			version: r.version ?? "",
			scope: r.scope ?? null,
			processFile: r.processFile ?? null,
			status: r.status,
			reason: r.reason ?? null,
			modes: r.requests
				? [{ mode: r.mode, status: r.status, exitCode: r.exitCode, timedOut: r.timedOut, marker: r.marker, injected: r.injected, chars: r.chars, requests: r.requests }]
				: [],
			hotSwitch: { status: "not-tested" },
		});
	}
	writeVerification(join(root, "verification", "latest.json"), report);
	return report;
}

export async function captureHarness(h, out) {
	const bin = resolveHarnessBin(h);
	if (!bin) return { harness: h, status: "unavailable", reason: "Executable not found" };
	const root = trackRoot(mkdtempSync(join(tmpdir(), `ap-capture-${h}-`)));
	const env = isolatedEnv(root);
	const cwd = join(root, "work");
	mkdirSync(cwd);
	env.AGENT_PURGE_REAL_BIN = bin;
	const version = await runProcess(bin, ["--version"], { env, cwd, timeout: 12000 });
	put(join(out, h, "version.json"), version);
	const report = { harness: h, executable: bin, version: version.stdout.trim(), isolation: root,
		scope: { kind: "isolated-cli", profile: h === "dsh" ? "headless" : null, syntheticPersona: true, currentSession: false },
		modes: [], hotSwitch: { status: "not-tested", reason: "Startup capture does not prove same-session switching" } };
	if (h === "hermes") {
		report.status = "blocked";
		report.reason = (version.stderr || version.stdout).trim() || "No isolated provider adapter";
		return report;
	}
	const provider = await startCaptureProvider(join(out, h, "requests"));
	const flags = configure(h, env, provider.url, cwd);
	if (!flags) {
		await provider.close();
		return { ...report, status: "blocked", reason: "Provider/isolation adapter not yet verified for this executable" };
	}
	try {
		await prepareCapture(h, bin, env, cwd, out, 35000, "off");
		for (const mode of ["off", "strict", "replace", "append"]) {
			const marker = `AP_CAPTURE_${h}_${mode}_${randomUUID()}`;
			const body = `Capture-only neutral persona. Marker: ${marker}. Reply briefly.`;
			seed(env, h, mode, body);
			const start = provider.captures.length;
			const command = agentCommand([h, "--ask", "Reply CAPTURE_OK.", "--", ...flags]);
			const result = await runProcess(command.cmd, command.args, { env, cwd });
			put(join(out, h, mode + ".process.json"), result);
			const requests = provider.captures.slice(start);
			const analyses = requests.map((r) => ({ id: r.id, protocol: r.protocol, kind: requestKind(r.body), ...inspectRequest(r.body, marker) }));
			const checks = analyses.filter((a) => a.kind === "main");
			report.modes.push({ mode, ...captureOutcome(result, checks, mode), exitCode: result.code, timedOut: result.timedOut, marker, requests: analyses.map(({ text: _text, ...a }) => a) });
			console.log(`${h} ${mode}: ${report.modes.at(-1).status} (${checks.length} request, exit ${result.code})`);
		}
		report.status = report.modes.every((r) => r.status === "captured") ? "captured" : "partial";
		return report;
	} finally {
		await provider.close();
	}
}
