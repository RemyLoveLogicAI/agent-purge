// Persona management: one Markdown file contains metadata (frontmatter) and the system prompt body.
// Only the body is sent to the harness; metadata is used for selection.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadState, saveState } from "./state.mjs";
import { listResources, readResource } from "./root.mjs";

const TEMPLATES = "lib/templates/personas/";

const WILD = "*";
// active.md is derived, not state: installs point to it and the OpenCode plugin reads it at runtime for hot switching.
// The actual pointer is the persona field in state.json; loadState migrates the old personas/.active layout.
const ACTIVE_BODY = "active.md";
const RESERVED_IDS = new Set([ACTIVE_BODY.slice(0, -3), ".active"]); // "active" / ".active"

export function createStore(root) {
	const dir = join(root, "personas");
	const build = join(dir, ".build");
	mkdirSync(build, { recursive: true });

	// On first run or an empty npm installation, copy a neutral starter persona from lib/templates/personas.
	{
		const has = existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".md") && f !== "active.md");
		if (!has) {
			try {
				for (const f of listResources(TEMPLATES)) writeFileSync(join(dir, f), readResource(TEMPLATES + f));
			} catch {
				// If the template directory is absent in a trimmed or custom install, skip it without blocking use.
			}
		}
	}

	const listFiles = () =>
		(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md") && !f.startsWith(".") && f !== "active.md") : []);

	function read(id) {
		if (!isValidId(id)) return null;
		const file = join(dir, `${id}.md`);
		if (!existsSync(file)) return null;
		const raw = readFileSync(file, "utf8");
		const { meta, body } = parse(raw);
		return { id, file, meta: normalizeMeta(meta), body, raw };
	}

	function list() {
		return listFiles()
			.map((f) => read(f.slice(0, -3)))
			.filter(Boolean)
			.sort((a, b) => (a.meta.order ?? 99) - (b.meta.order ?? 99) || a.id.localeCompare(b.id));
	}

	function save(id, { meta = {}, body }) {
		if (isReservedId(id)) throw new Error(`${id} is reserved for the active pointer; choose another ID`);
		if (!isValidId(id)) throw new Error(`Invalid persona ID: ${id} (no path separators or ..; maximum 64 characters)`);
		const file = join(dir, `${id}.md`);
		writeFileSync(file, serialize({ id, meta, body }));
		return read(id);
	}

	function remove(id) {
		if (!isValidId(id)) return false;
		const wasActive = activeId() === id;
		rmSync(join(dir, `${id}.md`), { force: true });
		rmSync(join(build, `${id}.md`), { force: true });
		// If deleting the active persona, redirect the pointer or the next no-argument launch will have no persona.
		// Prefer neutral instead of list()[0], whose ordering could silently switch personas.
		if (wasActive) {
			const all = list();
			const next = all.find((p) => p.id === "neutral") ?? all[0] ?? null;
			if (next) setActive(next.id);
			else {
				const { state } = loadState(root);
				saveState(root, { ...state, persona: null });
				writeFileSync(join(dir, ACTIVE_BODY), "");
			}
		}
		return true;
	}

	// Write the body to .build for harnesses requiring a file path; frontmatter must not enter the prompt.
	function materialize(id) {
		const p = read(id);
		if (!p) return null;
		const out = join(build, `${id}.md`);
		writeFileSync(out, p.body.trim() + "\n");
		return out;
	}

	function activeId() {
		const { state } = loadState(root);
		if (state.persona && read(state.persona)) return state.persona;
		return list()[0]?.id ?? null;
	}

	function setActive(id) {
		const p = read(id);
		if (!p) throw new Error(`no such persona: ${id}`);
		// Write the body snapshot before the pointer; interruption leaves at most an extra consistent snapshot.
		writeFileSync(join(dir, ACTIVE_BODY), p.body.trim() + "\n");
		const { state } = loadState(root);
		saveState(root, { ...state, persona: id });
	}

	// Call before install to update active.md and return its path for file-based backends.
	function refreshActive() {
		const id = activeId();
		if (id) setActive(id);
		return join(dir, ACTIVE_BODY);
	}

	// Selected persona: prefer exact harness+model, then active, then the first.
	function resolve({ harness, model } = {}) {
		const all = list();
		const scored = all.map((p) => {
			const h = asArray(p.meta.harness);
			const m = asArray(p.meta.model);
			const hHit = h.includes(WILD) ? 1 : h.some((g) => globHit(g, harness));
			const mHit = m.includes(WILD) ? 1 : m.some((g) => globHit(g, model));
			const explicitH = hHit && !h.includes(WILD) ? 1 : 0;
			const explicitM = mHit && !m.includes(WILD) ? 1 : 0;
			return { p, hit: hHit && mHit, score: explicitH * 2 + explicitM * 4 };
		});
		const eligible = scored.filter((s) => s.hit).sort((a, b) => b.score - a.score || a.p.id.localeCompare(b.p.id));
		const active = activeId();
		const fallback = all.find((p) => p.id === active) ?? all[0] ?? null;
		return { persona: eligible[0]?.p ?? fallback, matched: Boolean(eligible[0]), score: eligible[0]?.score ?? 0 };
	}

	return { dir, build, list, read, save, remove, materialize, activeId, setActive, refreshActive, resolve };
}

/** Reserved IDs become persona filenames and conflict with the active pointer. */
export function isReservedId(id) {
	return RESERVED_IDS.has(String(id || ""));
}

/** Persona IDs form filenames: reject path separators and .. to avoid reading or deleting outside the data directory. */
export function isValidId(id) {
	const s = String(id ?? "").trim();
	return Boolean(s) && s.length <= 64 && !s.includes("..") && !/[\\/:*?"<>|\0]/.test(s) && !isReservedId(s);
}

function parse(raw) {
	if (!raw.startsWith("---")) return { meta: {}, body: raw };
	const end = raw.indexOf("\n---", 3);
	if (end === -1) return { meta: {}, body: raw };
	const head = raw.slice(3, end).trim();
	const body = raw.slice(end + 4).replace(/^\r?\n/, "");
	return { meta: parseMeta(head), body };
}

function parseMeta(head) {
	const meta = {};
	let key = null;
	for (const line of head.split(/\r?\n/)) {
		if (!line.trim()) continue;
		const arr = line.match(/^\s*-\s+(.*)$/);
		if (arr && key) {
			if (!Array.isArray(meta[key])) meta[key] = [];
			meta[key].push(unquote(arr[1]));
			continue;
		}
		const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
		if (!kv) continue;
		key = kv[1];
		const v = kv[2].trim();
		if (!v) {
			meta[key] = [];
			continue;
		}
		if (v.startsWith("[")) {
			meta[key] = v
				.replace(/^\[|\]$/g, "")
				.split(",")
				.map((s) => unquote(s.trim()))
				.filter(Boolean);
		} else meta[key] = coerce(v);
	}
	return meta;
}

function serialize({ id, meta, body }) {
	const lines = ["---", `id: ${meta.id ?? id}`];
	const seen = new Set(["id"]);
	for (const [k, v] of Object.entries(meta)) {
		// desc is the old UI key; README/templates use description. Write only description to avoid duplicate fields.
		const key = k === "desc" ? "description" : k;
		if (seen.has(key)) continue;
		if (Array.isArray(v)) {
			seen.add(key);
			lines.push(`${key}: [${v.map((x) => JSON.stringify(String(x))).join(", ")}]`);
		} else if (v !== undefined && v !== null && v !== "") {
			seen.add(key);
			// Write numbers and booleans bare (`order: 1`, `enabled: true`); quote strings only, preserving types.
			lines.push(`${key}: ${typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(String(v))}`);
		}
	}
	lines.push("---", "", body.trim(), "");
	return lines.join("\n");
}

/**
 * Normalize keys: disk may use README/template `description` or 0.2.x UI `desc`.
 * Store as description and expose desc as a read alias for CLI lists and Web forms.
 */
function normalizeMeta(meta) {
	if (meta.description !== undefined && meta.desc === undefined) meta.desc = meta.description;
	if (meta.desc !== undefined && meta.description === undefined) meta.description = meta.desc;
	return meta;
}

const unquote = (s) => s.replace(/^["']|["']$/g, "");
/** Parse clean numeric and boolean scalars to their types; retain other strings such as `01`. */
function coerce(v) {
	const s = unquote(v);
	if (s === "true") return true;
	if (s === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(s) && String(Number(s)) === s) return Number(s);
	return s;
}
const asArray = (v) => (Array.isArray(v) ? v : v ? [String(v)] : [WILD]);

function globHit(pattern, value) {
	if (!value) return pattern === WILD;
	const re = new RegExp("^" + String(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
	return re.test(value);
}
