// agent-purge × magpie: gateway-level persona injection.
// This asynchronous hook runs once per gateway request in Bun. It rewrites the system
// section using agent-purge's current persona and mode; changes apply on the next request.
// off leaves requests unchanged; strict replaces the system prompt including tool instructions;
// append prepends the persona while preserving the host prompt; replace prepends the persona
// and approximately removes identity lines. For a cleaner result use strict, since the
// gateway lacks per-harness launch arguments.
// Options: mode overrides the active mode, subject to global and per-host pause; persona
// selects an ID (default state.json); agents is an allowlist (default all); disabledAgents
// takes precedence; inlinePersonas [{id,name,text}] override personas/<id>.md by ID.
// Example: magpie plugin options agent-purge '{"mode":"append"}'

import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as abs } from "node:path";

const MODES = ["strict", "replace", "append", "off"];
const SEP = "\n\n";

function dataHome() {
	const env = process.env.AGENT_PURGE_HOME?.trim();
	if (!env) return join(homedir(), ".agent-purge");
	return isAbsolute(env) ? env : abs(env);
}

/** Frontmatter must never enter the prompt (agent-purge strips it on disk too). */
const stripFront = (raw) => String(raw).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();

// Each request has a one-second budget, so reread only when state.json or persona file mtime changes.
let cache = { key: "", value: { mode: "off", text: "" } };

const validId = id => typeof id === 'string' && id.length <= 64 && /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/.test(id) && !id.includes('..');
function current(personaId, inline = [], agent) {
	const home = dataHome();
	const stateFile = join(home, "state.json");
	let sst = null;
	try {
		sst = statSync(stateFile);
	} catch {
		/* If agent-purge was never installed, treat it as off. */
	}

	let mode = "off";
	let active = null;
	let bound = false;
	if (sst) {
		try {
			const state = JSON.parse(readFileSync(stateFile, "utf8"));
			if (!state || typeof state !== 'object' || Array.isArray(state)) return { blocked: true };
			bound = true;
			const override = state.overrides?.[agent];
			if (state.default?.mode === 'off' || override?.mode === 'off' || state.disabledHarnesses?.includes(agent)) return { blocked: true };
			active = override?.persona ?? state.persona;
			mode = override?.mode ?? state.default?.mode ?? 'replace';
			if (!MODES.includes(mode)) return { blocked: true };
		} catch { return { blocked: true }; }
	}

	const id = personaId || active;
	if (!validId(id)) return { mode, text: "", bound };
	// Page imports are stored in options; if found, do not read disk (one-second request budget).
	const hit = inline.find((p) => p && typeof p === "object" && p.id === id && typeof p.text === "string" && p.text.trim());
	if (hit) return { mode, text: stripFront(hit.text), bound };
	// Without state.json, the standalone plugin accepts only explicitly imported personas and never activates from leftovers.
	if (!bound) return { mode: 'off', text: '' };
	const file = join(home, "personas", `${id}.md`);
	let pst = null;
	try {
		pst = statSync(file);
	} catch {
		return { mode, text: "" };
	}

	const key = `${sst?.mtimeMs}:${sst?.size}|${file}:${pst.mtimeMs}:${pst.size}`;
	if (key !== cache.key) cache = { key, value: { text: stripFront(readFileSync(file, "utf8")) } };
	return { mode, text: cache.value.text };
}

// Approximate replace removes only lines containing both self-identification and a named model or vendor.
const SELF = /^\s*(?:You are|You're|\u4f60\u662f|\u60a8\u662f|\u6211(?:\u662f|\u73b0\u5728\u626e\u6f14|\u5c31\u662f))/i;
const NAMED =
	/(Claude|ChatGPT|GPT-?[45]|Gemini|Codex|Copilot|DeepSeek|Qwen|Kimi|GLM|Cursor|Windsurf|AI (?:assistant|model)|\u8bed\u8a00\u6a21\u578b|\u52a9\u624b)/i;
const stripIdentity = (text) =>
	String(text ?? "")
		.split("\n")
		.filter((line) => !(SELF.test(line) && NAMED.test(line)))
		.join("\n")
		.trim();

const textOf = (content) => {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("");
	return "";
};

// System locations for four agent APIs. Preserve block structure including cache_control where possible:
// flattening to a string invalidates client cache breakpoints and incurs charges on every turn.
function anthropicSystem(body, persona, mode) {
	const cur = body.system;
	const blocks =
		typeof cur === "string"
			? cur
				? [{ type: "text", text: cur }]
				: []
			: Array.isArray(cur)
				? cur.filter((b) => b && typeof b === "object").map((b) => ({ ...b }))
				: [];
	if (mode === "strict") {
		body.system = [{ type: "text", text: persona }];
		return;
	}
	if (mode === "replace") for (const b of blocks) if (typeof b.text === "string") b.text = stripIdentity(b.text);
	body.system = [{ type: "text", text: persona }, ...blocks];
}

function chatSystem(body, persona, mode) {
	if (!Array.isArray(body.messages)) body.messages = [];
	const msgs = body.messages;
	const i = msgs.findIndex((m) => m?.role === "system" || m?.role === "developer");
	if (mode === "strict") {
		const first = i >= 0 ? { ...msgs[i], content: persona } : { role: 'system', content: persona };
		body.messages = msgs.filter(m => m?.role !== 'system' && m?.role !== 'developer');
		body.messages.splice(i < 0 ? 0 : Math.min(i, body.messages.length), 0, first);
		return;
	}
	if (i < 0) {
		msgs.unshift({ role: "system", content: persona });
		return;
	}
	const m = msgs[i];
	const host = mode === "replace" ? stripIdentity(textOf(m.content)) : textOf(m.content);
	m.content = host ? persona + SEP + host : persona;
}

function responsesSystem(body, persona, mode) {
	const host = typeof body.instructions === "string" ? body.instructions : "";
	if (mode === "strict") {
		body.instructions = persona;
		return;
	}
	const keep = mode === "replace" ? stripIdentity(host) : host;
	body.instructions = keep ? persona + SEP + keep : persona;
}

function geminiSystem(body, persona, mode) {
	const key = body.systemInstruction ? "systemInstruction" : body.system_instruction ? "system_instruction" : "systemInstruction";
	const cur = body[key];
	const parts = Array.isArray(cur?.parts) ? cur.parts.filter((p) => p && typeof p === "object").map((p) => ({ ...p })) : [];
	if (mode === "strict") {
		body[key] = { parts: [{ text: persona }] };
		return;
	}
	if (mode === "replace") for (const p of parts) if (typeof p.text === "string") p.text = stripIdentity(p.text);
	body[key] = { ...(cur ?? {}), parts: [{ text: persona }, ...parts] };
}

const REWRITE = { anthropic: anthropicSystem, chat: chatSystem, responses: responsesSystem, gemini: geminiSystem };

// Roll back only whole requests produced by this hook; never infer provenance from persona fragments or user-supplied labels.
const originals = new Map();
function restoreOwn(body, scope) {
	const key = scope + JSON.stringify(body), before = originals.get(key);
	if (!before) return false;
	try {
		const original = JSON.parse(before);
		for (const name of Object.keys(body)) delete body[name];
		Object.assign(body, original);
		return true;
	} catch { return false; }
}
function remember(before, body, scope) {
	const serialized = JSON.stringify(body);
	if (before === serialized || before.length + serialized.length > 2 * 1024 * 1024) return;
	const after = scope + serialized;
	if (originals.has(after) && originals.get(after) !== before) originals.set(after, null);
	else originals.set(after, before);
	while (originals.size > 64) originals.delete(originals.keys().next().value);
}

/** Called once per magpie request: return an object to use the modified request, or undefined to pass it through. */
export async function onRequest(body, ctx) {
	try {
		if (!body || typeof body !== "object" || Array.isArray(body)) return;
		const scope = `${ctx?.protocol ?? ''}:${ctx?.agent ?? ''}:`;
		const restored = restoreOwn(body, scope);
		const opt = ctx?.options && typeof ctx.options === "object" ? ctx.options : {};
		const inline = Array.isArray(opt.inlinePersonas) ? opt.inlinePersonas : [];
		const cfg = current(typeof opt.persona === "string" ? opt.persona : null, inline, ctx?.agent);
		const mode = MODES.includes(opt.mode) ? opt.mode : cfg.mode;
		if (cfg.blocked || mode === "off" || !cfg.text) {
			ctx?.report?.("skipped", 0);
			return restored ? body : undefined;
		}
		const disabledAgents = Array.isArray(opt.disabledAgents) ? opt.disabledAgents : [];
		if (disabledAgents.includes(ctx.agent)) {
			ctx?.report?.("skipped", 0);
			return restored ? body : undefined;
		}
		const agents = Array.isArray(opt.agents) ? opt.agents : [];
		if (agents.length && !agents.includes(ctx.agent)) {
			ctx?.report?.("skipped", 0);
			return restored ? body : undefined;
		}
		const rewrite = REWRITE[ctx?.protocol];
		if (!rewrite) {
			ctx?.report?.("unavailable", 0);
			return;
		}
		const before = JSON.stringify(body);
		rewrite(body, cfg.text, mode);
		remember(before, body, scope);
		ctx?.report?.("ready", cfg.text.length);
		return body;
	} catch {
		// Fail open: pass through unchanged if rewriting fails rather than breaking the request.
		try {
			ctx?.report?.("invalid", 0);
		} catch {
			/* A reporting failure must not prevent pass-through. */
		}
	}
}
