// Mode semantics are shared with generated plugins; at runtime only complete transformations with recorded provenance are restored.
import { activationRuntime } from "./activation.mjs";
export function stripPiDocs(text) {
	let out = String(text ?? "");
	const joinCut = (start, end) => {
		const before = out.slice(0, start).replace(/[\r\n]+$/, "");
		const after = out.slice(end).replace(/^[\r\n]+/, "");
		return before && after ? `${before}\n\n${after}` : (before || after);
	};
	const docsPrefix = "Pi documentation (read only when the user asks about ";
	const tagAt = (() => {
		const lf = out.indexOf("<docs>\n" + docsPrefix);
		return lf !== -1 ? lf : out.indexOf("<docs>\r\n" + docsPrefix);
	})();
	if (tagAt !== -1) {
		const tagEnd = out.indexOf("</docs>", tagAt + 6);
		if (tagEnd !== -1) {
			let end = tagEnd + 7;
			if (out[end] === "\r") end += 1;
			if (out[end] === "\n") end += 1;
			out = joinCut(tagAt, end);
		}
	}
	const bareAt = out.indexOf(docsPrefix);
	if (bareAt !== -1) {
		for (const endMarker of ["following related cross-references.", "(e.g., tui.md for TUI API details)"]) {
			const endAt = out.indexOf(endMarker, bareAt + docsPrefix.length);
			if (endAt !== -1) {
				const nl = out.indexOf("\n", endAt + endMarker.length);
				out = joinCut(bareAt, nl === -1 ? out.length : nl + 1);
				break;
			}
		}
	}
	return out;
}

export function stripIdentity(text) {
	const self = /^\s*(?:You are|You're|\u4f60\u662f|\u60a8\u662f|\u6211(?:\u662f|\u73b0\u5728\u626e\u6f14|\u5c31\u662f))/i;
	const named = /(Claude|ChatGPT|GPT-?[45]|Gemini|Codex|Copilot|DeepSeek|Qwen|Kimi|GLM|Cursor|Windsurf|OpenCode|ZCode|CodeBuddy|Hermes|Grok|Antigravity|AI (?:assistant|model)|coding (?:assistant|agent)|\u8bed\u8a00\u6a21\u578b|\u52a9\u624b)/i;
	return stripPiDocs(text).split(/\r?\n/).filter(line => !(self.test(line) && named.test(line))).join("\n").trim();
}

export function cleanManaged(text, bodies = []) {
	let out = String(text ?? "").replace(/^# >>> agent-purge[^\S\r\n]*\r?\n[\s\S]*?^# <<< agent-purge[^\S\r\n]*(?:\r?\n|$)/gm, "");
	for (const body of bodies) {
		if (!body) continue;
		// Remove only the entire standalone body; a different persona or user rule sharing the first 40 characters does not match.
		const literal = String(body).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		out = out.replace(new RegExp("(^|\\n)" + literal + "(?=\\n|$)", "g"), "$1");
	}
	return out.trim();
}

export function rewriteTexts(hostTexts, persona, mode) {
	if (mode === "off" || !persona) return hostTexts;
	const host = (Array.isArray(hostTexts) ? hostTexts : []).map(t => String(t ?? "")).filter(t => t.trim());
	if (mode === "strict") return [persona];
	if (mode === "append") return [...host, persona];
	return [persona, ...host.map(stripIdentity).filter(Boolean)];
}

export function rewriteSections(sections, persona, mode, name = "agent-purge", options = {}) {
	const list = Array.isArray(sections) ? sections : [];
	if (mode === "off" || !persona) return list;
	const extra = {};
	if (options.order !== undefined) extra.order = options.order;
	if (options.complete !== undefined) extra.complete = options.complete;
	if (mode === "strict") return [{ name, text: persona, interpolate: false, ...extra }];
	if (mode === "append") return [...list, { name, text: persona, interpolate: false, ...extra }];
	const kept = list.map(s => typeof s?.text === "string" ? { ...s, text: stripIdentity(s.text) } : s)
		.filter(s => typeof s?.text !== "string" || s.text.trim());
	return [{ name, text: persona, interpolate: false, ...extra }, ...kept];
}

/** Bounded records of complete transformations: preserve input when provenance is missing or ambiguous; never guess from labels or persona text. */
export function createProvenance(limit = 64) {
	const values = new Map();
	const objects = new WeakMap();
	const key = value => JSON.stringify(value);
	function remember(before, after, aliases = []) {
		const beforeKey = key(before), afterKey = key(after);
		if (beforeKey === afterKey) return after;
		const entry = { before: structuredClone(before), beforeKey, afterKey };
		if (after && typeof after === "object") objects.set(after, entry);
		for (const candidate of [after, ...aliases]) {
			const id = key(candidate), previous = values.get(id);
			values.set(id, previous && previous.beforeKey !== beforeKey ? { ambiguous: true } : previous?.ambiguous ? previous : entry);
		}
		while (values.size > limit) values.delete(values.keys().next().value);
		return after;
	}
	function restore(value) {
		const id = key(value);
		const direct = value && typeof value === "object" ? objects.get(value) : null;
		const entry = direct?.afterKey === id ? direct : values.get(id);
		return entry && !entry.ambiguous ? structuredClone(entry.before) : value;
	}
	return { remember, restore };
}

export function createTextRewriter() {
	const provenance = createProvenance();
	return (texts, persona, mode) => {
		const host = provenance.restore(texts);
		if (mode === "off" || !persona) return host;
		const next = rewriteTexts(host, persona, mode);
		return provenance.remember(host, next, [[next.join("\n\n")]]);
	};
}

export function createSectionRewriter() {
	const provenance = createProvenance();
	return (sections, persona, mode, name = "agent-purge", options = {}) => {
		const host = provenance.restore(sections);
		if (mode === "off" || !persona) return host;
		return provenance.remember(host, rewriteSections(host, persona, mode, name, options));
	};
}

/** Anthropic-style content blocks: retain non-text blocks and cache metadata. */
export function createContentRewriter() {
	const provenance = createProvenance();
	return (blocks, persona, mode) => {
		const host = provenance.restore(blocks);
		if (mode === "off" || !persona || !Array.isArray(host)) return host;
		let next;
		if (mode === "strict") {
			const text = host.find(b => b?.type === "text");
			const own = { ...text, type: "text", text: persona };
			next = [own, ...host.filter(b => b?.type !== "text")];
		} else {
			const kept = mode === "replace" ? host.map(b => typeof b?.text === "string" ? { ...b, text: stripIdentity(b.text) } : b) : host;
			const own = { type: "text", text: persona };
			next = mode === "append" ? [...kept, own] : [own, ...kept];
		}
		return provenance.remember(host, next);
	};
}

export const rewriteRuntime = [stripPiDocs, stripIdentity, cleanManaged, rewriteTexts, rewriteSections, createProvenance, createTextRewriter, createSectionRewriter, createContentRewriter]
	.map(fn => fn.toString()).join("\n") + `
const apStrip = stripIdentity;
const apRewrite = createTextRewriter();
const apRewriteSections = createSectionRewriter();
const apRewriteContent = createContentRewriter();
`;

export const resolveRuntime = activationRuntime;

/** Read a specified persona override directly from personas/<id>.md, stripping frontmatter; fall back to embedded active.md if unavailable. */
export const personaBodyRuntime = `
function resolvePersonaBody(personas, id, fallback) {
  if (id && id !== "active" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id)) {
    try {
      const raw = readFileSync(personas + "/" + id + ".md", "utf8").replace(/^---\\r?\\n[\\s\\S]*?\\r?\\n---(?:\\r?\\n|$)/, "");
      if (raw.trim()) return raw.trim();
    } catch { return ""; }
  }
  return readFileSync(fallback, "utf8").trim();
}
`;
