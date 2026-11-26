// Each host build() is pure: it describes how to launch without spawning or writing to disk.
// The entry point invokes setup/cleanup to ensure hash-checked rollback.
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SESSION as DSH_SESSION, addPlugin, sessionSource } from "../lib/dsh.mjs";
import { opencodePlugins, targets } from "../lib/persist.mjs";
import { opencodeSource } from "../lib/opencode.mjs";
import { dataHome } from "../lib/home.mjs";
import { swapFile } from "../lib/restore.mjs";
import { installKilocode, uninstallKilocode } from "../lib/kilocode.mjs";
import { antigravityBin, temporaryAntigravity } from "../lib/antigravity.mjs";
import { AGENT_NAME as KIRO_AGENT, temporaryKiroAgent } from "../lib/kiro.mjs";
import { kimiAgentFile, temporaryKimiAgent } from "../lib/kimi.mjs";

function temporaryPlugin(harness, file, root, args) {
 let undo = null;
 return { cmd: harness, args, runtime: true,
  setup: () => { mkdirSync(join(file, ".."), { recursive: true }); if (!undo) undo = swapFile(file, opencodeSource(root, harness, { temporary: true })); },
  cleanup: () => { if (undo) { undo(); undo = null; } },
 };
}

const inline = (text) => text.replace(/\s+$/, "");
// Codex parses -c values as TOML: wrap the persona in a basic string so spaces, quotes and newlines parse correctly.
const tomlStr = (value) => JSON.stringify(String(value));

export const backends = {
	// pi: --system-prompt was tested, but pi.cmd uses cmd.exe and a 10K persona exceeds its 8191-character limit.
	// Therefore pi injects through an extension (sys layer, no length limit, following state.json); this passes arguments through.
	// launch() ensures the extension is installed before starting.
	pi: ({ args }) => ({ cmd: "pi", args }),

	codex: ({ personaPath, personaText, mode, args }) => ({
		cmd: "codex",
		args:
			mode === "off"
				? [...args]
				: mode === "append"
					? ["-c", `developer_instructions=${tomlStr(inline(personaText))}`, ...args]
					: ["-c", `model_instructions_file=${tomlStr(personaPath.replace(/\\/g, "/"))}`, ...args],
	}),

// CodeBuddy (Tencent Cloud, npm @tencent-ai/codebuddy-code): native full replacement, no residue.
	codebuddy: ({ personaPath, personaText, mode, args }) => ({
		cmd: "codebuddy",
		args:
			mode === "off"
				? [...args]
				: mode === "append"
					? ["--append-system-prompt", inline(personaText), ...args]
					// Replace uses a file: inline 9.6K text exceeds the 8191 limit for a bare command with a .cmd wrapper.
					: ["--system-prompt-file", personaPath, ...args],
	}),

	claude: ({ personaPath, mode, args }) => ({
		cmd: "claude",
		args:
			mode === "off"
				? [...args]
				: mode === "append"
					? ["--append-system-prompt-file", personaPath, ...args]
					: ["--system-prompt-file", personaPath, ...args],
		residueHint: mode === "off" ? "" : "A 62-character identity sentence remains without patching",
	}),

	grok: ({ personaText, mode, args }) => ({
		cmd: "grok",
		args:
			mode === "off"
				? [...args]
				: mode === "append"
					? ["--rules", inline(personaText), ...args]
					: ["--system-prompt-override", inline(personaText), ...args],
	}),

	omp: ({ personaText, mode, args }) =>
		mode === "off"
			? { cmd: "omp", args: [...args] }
			: {
					cmd: "omp",
					args: [mode === "append" ? "--append-system-prompt" : "--system-prompt", inline(personaText), ...args],
					residueHint: "MCP tool routes are still appended (roughly 10K); disabling the MCP server can reduce this",
				},

	// Temporary and persistent plugins do not share authorization; persona text is not compiled into orphan files.
	opencode: ({ mode, cwd, args, root = dataHome() }) => {
		if (mode === "off") return { cmd: "opencode", args: [...args] };
		return temporaryPlugin("opencode", join(cwd, ".opencode", "plugin", "agent-purge.ts"), root, args);
	},
	dsh: ({ mode, args, root = dataHome() }) => {
		if (mode === "off") return { cmd: "dsh", args: ["--profile", "headless", ...args] };
		let temporary = null;
		return { cmd: "dsh", args: ["--profile", "headless", ...args], runtime: true,
			setup: () => { if (!temporary) temporary = addPlugin(DSH_SESSION, sessionSource("", mode, root), { temporary: true }); },
			cleanup: () => { if (temporary) { temporary.cleanup(); temporary = null; } } };
	},
	opencode2: ({ mode, args, root = dataHome() }) => {
		if (mode === "off") return { cmd: "opencode2", args: [...args], privateServer: true };
		return { ...temporaryPlugin("opencode2", join(opencodePlugins(), "agent-purge-v2-session.ts"), root, args), privateServer: true };
	},

	// Kilo Code：code.md overrides the default code agent prompt; AGENTS.md is the append channel.
	// One-shot runs use a temporary install restored from stash on exit; for interactive use, first run agent-purge install kilo.
	kilo: ({ personaText, mode, args, root = dataHome() }) => {
		if (mode === "off") return { cmd: "kilo", args: ["run", ...args] };
		let installed = false;
		return {
			cmd: "kilo",
			args: ["run", ...args],
			setup: () => { if (!installed) { installKilocode(root, { personaText, mode }); installed = true; } },
			cleanup: () => { if (installed) { uninstallKilocode(root); installed = false; } },
		};
	},

	// When disk writes or caller cooperation are required, the CLI supplies a copyable recipe rather than doing it automatically.
	// Qwen Code：Official --system-prompt / --append-system-prompt; long text is subject to command-line length limits.
	qwen: ({ personaText, mode, args }) => ({
		cmd: "qwen",
		args:
			mode === "off"
				? [...args]
				: [mode === "append" ? "--append-system-prompt" : "--system-prompt", inline(personaText), ...args],
		residueHint: mode === "off" ? "" : "Persona is passed on the command line; very long text may exceed the Windows command-line limit",
	}),


	// Crush：Persona uses a managed block in global CRUSH.md (install channel); the CLI only starts the host.
	crush: ({ args = [] }) => ({ cmd: "crush", args: [...args] }),


	// Continue CLI：--rule accepts a file path and appends rules/context; it does not replace core system text.
	continue: ({ personaPath, mode, args = [] }) => ({
		cmd: "cn",
		args: mode === "off" ? [...args] : ["--rule", personaPath, ...args],
		residueHint: mode === "off" ? "" : "Persona is passed as a rule and affects only this launch",
	}),

	// Qoder CLI：Two official arguments replace the full system prompt or append to it.
	qoder: ({ personaText, mode, args = [] }) => ({
		cmd: "qodercli",
		args: mode === "off" ? [...args] : [mode === "append" ? "--append-system-prompt" : "--system-prompt", inline(personaText), ...args],
		residueHint: mode === "off" ? "" : "Persona is passed on the command line and affects only this launch",
	}),

	// Kimi Code：The agent file Markdown body is that agent’s system prompt.
	kimi: ({ personaText, mode, args = [] }) => {
		if (mode === "off") return { cmd: "kimi", args: [...args] };
		let undo = null;
		return {
			cmd: "kimi",
			args: ["--agent-file", kimiAgentFile(), ...args],
			runtime: true,
			note: "Temporarily writes ~/.kimi-code/agents/agent-purge.md; restores original bytes on exit",
			setup: () => { if (!undo) undo = temporaryKimiAgent({ personaText }); },
			cleanup: () => { if (undo) { undo(); undo = null; } },
		};
	},

	// Auggie CLI：--rules only appends content to rules[] (identity remained in testing);
	// full replacement uses the hidden --override-system-prompt (tested to replace system_prompt with only the persona).
	// Replace/strict use the latter, append uses --rules, matching whether the host identity is actually replaced.
	auggie: ({ personaPath, mode, args = [] }) => {
		if (mode === "off") return { cmd: "auggie", args: [...args] };
		const whole = mode === "replace" || mode === "strict";
		return {
			cmd: "auggie",
			args: [whole ? "--override-system-prompt" : "--rules", personaPath, ...args],
			residueHint: whole
				? "Persona replaces the entire system prompt; affects only this launch"
				: "Persona is appended as rules[]; host identity remains (use replace to remove it)",
		};
	},

	// Goose：--system appends system instructions rather than replacing the whole prompt.
	goose: ({ personaText, mode, args = [] }) => ({
		cmd: "goose",
		args: mode === "off" ? ["session", ...args] : ["session", "--system", inline(personaText), ...args],
		residueHint: mode === "off" ? "" : "Persona is passed on the command line and affects only this launch",
	}),

	// Kiro CLI：The custom agent prompt is the main session system prompt; write a temporary agent before launch and restore it on exit.
	kiro: ({ personaText, mode, args = [] }) => {
		if (mode === "off") return { cmd: "kiro-cli", args: ["chat", ...args] };
		let undo = null;
		return {
			cmd: "kiro-cli",
			args: ["chat", "--agent", KIRO_AGENT, ...args],
			runtime: true,
			note: "Temporarily writes ~/.kiro/agents/agent-purge.json; restores original bytes on exit",
			setup: () => { if (!undo) undo = temporaryKiroAgent({ personaText }); },
			cleanup: () => { if (undo) { undo(); undo = null; } },
		};
	},

	zcode: () => ({
		manual: [
			"CLI cannot receive customSystemPrompt (only app-server/SDK can pass it); CLI injection uses the UserPromptSubmit hook in the user role.",
			"Injection recipe: set hooks.enabled=true in ~/.zcode/cli/config.json and return additionalContext from a UserPromptSubmit hook.",
			"Zeroing recipe: replace IJs in resources/glm/zcode.cjs with an equal-length value (42 characters), but 42 characters remain in cli_prefix.",
		],
	}),

	// Interactive: SOUL.md is the sole identity entry point. Write before launch and restore on exit (keep it while managed in UI).
	// SOUL.md is read only when a session is first created or rebuilt; resumed sessions restore the system prompt from the session DB, so edits are not immediate.
	// (Source: agent/conversation_loop.py::_restore_or_build_system_prompt.)
	hermes: ({ personaText, personaPath, mode, args = [] }) => {
		let undo = null;
		return {
			cmd: "hermes",
			args: [...(mode === "off" ? [] : ["--ignore-rules"]), ...args],
			note: "SOUL.md is read only by new sessions; original bytes are restored on exit without changing the persistent selection",
			setup: () => {
				if (mode === "off" || undo) return;
				const file = targets.hermes.file();
				mkdirSync(join(file, ".."), { recursive: true });
				const original = existsSync(file) ? readFileSync(file, "utf8") : "";
				const body = personaText ?? readFileSync(personaPath, "utf8");
				undo = swapFile(file, mode === "append" ? original + "\n\n" + body : body);
			},
			cleanup: () => { if (undo) { undo(); undo = null; } },
		};
	},

	// Antigravity：Persona must use ~/.gemini/config/AGENTS.md (shared by app and CLI; the app inserts it into
	// the <user_rules> section of systemInstruction). CLI lacks a --system-prompt launch option,
	// so install temporarily: write the managed block before launch and restore from stash on exit.
	antigravity: ({ personaText, mode, args = [] }) => {
		if (mode === "off") return { cmd: antigravityBin(), args };
		let undo = null;
		return {
			cmd: antigravityBin(),
			args,
			note: "Persona is written to ~/.gemini/config/AGENTS.md; original bytes are restored on exit (persistent blocks are untouched)",
			setup: () => { if (!undo) undo = temporaryAntigravity({ personaText, mode }); },
			cleanup: () => { if (undo) { undo(); undo = null; } },
		};
	},
};




// One-shot headless specifications shared by Web UI and `agent-purge <h> --ask`.
// Include only harnesses with tested arguments; do not guess for unverified hosts.
export const oneshots = {
	pi: ({ prompt }) => ({
		cmd: "pi",
		args: ["-p", prompt],
		note: "Injection uses an extension (sys layer); persona comes from state.json, not the command line",
	}),
	claude: ({ prompt, personaPath, mode }) => ({
		cmd: "claude",
		args: ["-p", prompt, ...(mode === "off" ? [] : [mode === "append" ? "--append-system-prompt-file" : "--system-prompt-file", personaPath])],
	}),
	grok: ({ prompt, personaText, mode }) => ({
		cmd: "grok",
		args: ["-p", prompt, "--always-approve", ...(mode === "off" ? [] : [mode === "append" ? "--rules" : "--system-prompt-override", inline(personaText)])],
	}),
	omp: ({ prompt, personaText, mode }) => ({
		cmd: "omp",
		args: ["-p", ...(mode === "off" ? [] : [mode === "append" ? "--append-system-prompt" : "--system-prompt", inline(personaText)]), prompt],
	}),
	codex: ({ prompt, personaPath, personaText, mode }) => ({
		cmd: "codex",
		args: [
			...(mode === "off"
				? []
				: ["-c", mode === "append" ? `developer_instructions=${tomlStr(inline(personaText))}` : `model_instructions_file=${tomlStr(personaPath.replace(/\\/g, "/"))}`]),
			"exec",
			prompt,
		],
	}),
	opencode: ({ prompt, personaText, mode, cwd, root }) => {
		if (mode === "off") return { cmd: "opencode", args: ["run", prompt] };
		const b = backends.opencode({ personaText, mode, cwd, root, args: ["run", prompt] });
		return b;
	},
	opencode2: ({ prompt, personaText, mode, root }) => {
		if (mode === "off") return { cmd: "opencode2", args: ["run", prompt], privateServer: true };
		const b = backends.opencode2({ personaText, mode, root, args: ["run", prompt] });
		return b;
	},
	dsh: ({ prompt, personaText, mode, root }) => {
		if (mode === "off") return { cmd: "dsh", args: ["--profile", "headless", prompt] };
		// backends.dsh adds --profile headless itself; pass only the prompt here to avoid duplication.
		return backends.dsh({ personaText, mode, root, args: [prompt] });
	},
	qwen: ({ prompt, personaText, mode }) => ({
		cmd: "qwen",
		args: ["-p", prompt, ...(mode === "off" ? [] : [mode === "append" ? "--append-system-prompt" : "--system-prompt", inline(personaText)])],
	}),
	crush: ({ prompt }) => ({ cmd: "crush", args: ["run", prompt] }),
	continue: ({ prompt, personaPath, mode }) => ({
		cmd: "cn",
		args: [...(mode === "off" ? [] : ["--rule", personaPath]), "-p", prompt],
	}),
	qoder: ({ prompt, personaText, mode }) => ({
		cmd: "qodercli",
		args: [...(mode === "off" ? [] : [mode === "append" ? "--append-system-prompt" : "--system-prompt", inline(personaText)]), "-p", prompt],
	}),
	kimi: ({ prompt, personaText, mode }) => {
		if (mode === "off") return { cmd: "kimi", args: ["-p", prompt] };
		let undo = null;
		return {
			cmd: "kimi",
			args: ["-p", prompt, "--agent-file", kimiAgentFile()],
			runtime: true,
			setup: () => { if (!undo) undo = temporaryKimiAgent({ personaText }); },
			cleanup: () => { if (undo) { undo(); undo = null; } },
		};
	},
	// One-shot requests also distinguish --rules append from replace/strict using --override-system-prompt.
	auggie: ({ prompt, personaPath, mode }) => ({
		cmd: "auggie",
		args: [
			...(mode === "off"
				? []
				: [mode === "replace" || mode === "strict" ? "--override-system-prompt" : "--rules", personaPath]),
			"-p",
			prompt,
		],
	}),
	goose: ({ prompt, personaText, mode }) => ({
		cmd: "goose",
		args: ["run", "-t", prompt, ...(mode === "off" ? [] : ["--system", inline(personaText)])],
	}),
	kiro: ({ prompt, personaText, mode }) => {
		if (mode === "off") return { cmd: "kiro-cli", args: ["chat", "--no-interactive", prompt] };
		let undo = null;
		return {
			cmd: "kiro-cli",
			args: ["chat", "--no-interactive", "--agent", KIRO_AGENT, prompt],
			runtime: true,
			setup: () => { if (!undo) undo = temporaryKiroAgent({ personaText }); },
			cleanup: () => { if (undo) { undo(); undo = null; } },
		};
	},

	zcode: ({ prompt }) => ({
		cmd: "zcode",
		args: ["--prompt", prompt, "--mode", "yolo", "--output-format", "stream-json", "--no-color"],
		note: "Persona has no effect on zcode CLI: customSystemPrompt can only be passed via app-server/SDK",
	}),
	kilo: ({ prompt, personaText, mode, root }) => {
		if (mode === "off") return { cmd: "kilo", args: ["run", prompt, "--format", "json"] };
		let installed = false;
		return {
			cmd: "kilo",
			args: ["run", prompt, "--format", "json"],
			setup: () => { if (!installed) { installKilocode(root, { personaText, mode }); installed = true; } },
			cleanup: () => { if (installed) { uninstallKilocode(root); installed = false; } },
		};
	},
	antigravity: ({ prompt, personaText, mode }) => {
		// agy lacks --system-prompt options: write the persona to AGENTS.md and restore original bytes after running.
		if (mode === "off") return { cmd: antigravityBin(), args: ["-p", prompt] };
		let undo = null;
		return {
			cmd: antigravityBin(),
			args: ["-p", prompt],
			note: "Persona is written to ~/.gemini/config/AGENTS.md; original bytes are restored on exit",
			setup: () => { if (!undo) undo = temporaryAntigravity({ personaText, mode }); },
			cleanup: () => { if (undo) { undo(); undo = null; } },
		};
	},

	codebuddy: ({ prompt, personaPath, personaText, mode }) => ({
		cmd: "codebuddy",
		args: [
			"-p",
			prompt,
			"--max-turns",
			"5",
			...(mode === "off"
				? []
				: mode === "append"
					? ["--append-system-prompt", inline(personaText)]
					: ["--system-prompt-file", personaPath]),
		],
	}),
	hermes: ({ prompt, personaText, personaPath, mode }) => backends.hermes({ personaText, personaPath, mode, args: ["-z", prompt] }),
};
