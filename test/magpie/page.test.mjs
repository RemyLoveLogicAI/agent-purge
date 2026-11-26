// Fake DOM and magpie run the actual page/app.js.
// The real page runs in a magpie sandbox; test search filtering and options merging without losing agents,
// rapid clicks and rollback on Save failed. Run: node test/magpie/page.test.mjs
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const appSrc = readFileSync(new URL("../../magpie-plugin/page/app.js", import.meta.url), "utf8");

class Node {
	constructor(tag = "div") {
		this.tag = tag;
		this.children = [];
		this.dataset = {};
		this.attrs = {};
		this.className = "";
		this.value = "";
		this.title = "";
		this.disabled = false;
		this.hidden = false;
		this.checked = false;
		this._text = "";
	}
	set textContent(v) {
		this._text = String(v);
		this.children = [];
	}
	get textContent() {
		return this._text;
	}
	append(...kids) {
		for (const k of kids) this.children.push(k);
	}
	setAttribute(k, v) {
		this.attrs[k] = String(v);
	}
}

const ids = [
	"now-persona",
	"now-mode",
	"mode",
	"q",
	"list",
	"status",
	"count",
	"file",
	"body",
	"pid",
	"pname",
	"import-save",
	"import-reset",
	"del-all",
	"import-count",
	"import-err",
	"scope-all",
	"scope-include",
	"scope-exclude",
	"agents-panel",
	"agents-list",
	"custom-agent",
	"add-agent-btn",
];
const nodes = Object.fromEntries(ids.map((id) => [id, new Node()]));
// #status / #import-err are hidden in index.html; app.js must unhide them.
nodes.status.hidden = true;
nodes["import-err"].hidden = true;
nodes["agents-panel"].hidden = true;
const document = { getElementById: (id) => nodes[id], createElement: (tag) => new Node(tag) };
class Option {
	constructor(text, value) {
		this.text = text;
		this.value = value;
	}
}

// Fake clock makes one-second throttling instantaneous for deterministic tests.
const realSetTimeout = globalThis.setTimeout;
let clock = 1_000_000;
const fakeSetTimeout = (fn) => {
	clock += 5000;
	queueMicrotask(fn);
	return 0;
};

const PERSONAS = [
	{ id: "terse", name: "\u6781\u7b80", description: "\u53ea\u56de\u7b54，\u4e0d\u89e3\u91ca" },
	{ id: "neutral", name: "\u4e2d\u6027\u52a9\u624b", description: "\u6700\u5c0f\u8eab\u4efd" },
	{ id: "ctf", name: "ctf", description: "" },
];
const window = { PERSONAS };

const calls = [];
let store = { persona: "terse", mode: "append", agents: ["claude"] };
let failNext = false;
const magpie = {
	ready: Promise.resolve(),
	options: {
		async get() {
			return { ...store };
		},
		async set(o) {
			calls.push({ ...o });
			if (failNext) {
				failNext = false;
				throw new Error("boom");
			}
			store = { ...o };
			return { ...store };
		},
	},
};

const tick = () => new Promise((r) => realSetTimeout(r, 0));
// Button text lives in descendants; read the entire subtree.
const textOf = (n) => (n._text ?? "") + (n.children ?? []).map(textOf).join(" ");
const ok = (cond, msg) => {
	if (!cond) {
		console.error(`✗ ${msg}`);
		process.exitCode = 1;
	} else console.log(`✓ ${msg}`);
};
const btn = (name) => nodes.list.children.find((b) => textOf(b).includes(name));

// page/app.js is a classic script, not a module; sandbox execution matches the browser.
runInNewContext(appSrc, {
	magpie,
	document,
	Option,
	window,
	Promise,
	setTimeout: fakeSetTimeout,
	Date: { now: () => clock },
});
await tick();

// 1) Initial render: current settings, visible status, mode dropdown and persona list
ok(nodes["now-persona"].textContent === "\u6781\u7b80", "Current persona displays its name, not id");
ok(nodes["now-mode"].textContent === "append", "Current mode is displayed");
ok(nodes.status.hidden === false, "Status is no longer hidden (original bug)");
ok(nodes.mode.children.length === 5, "Mode dropdown has five options including follow");
ok(nodes.mode.value === "append", "Mode dropdown shows saved value");
ok(nodes.list.children.length === 3, "Persona list renders three entries");
ok(nodes.count.textContent === "All 3", "Title shows total");
ok(nodes.status.textContent.includes("only for claude"), "Status indicates agents filtering remains active");

// 2) Search actually filters (original bug: no binding)
nodes.q.value = "\u6781\u7b80";
nodes.q.oninput();
ok(nodes.list.children.length === 1 && textOf(nodes.list.children[0]).includes("\u6781\u7b80"), "Searching the concise persona returns one entry");
ok(nodes.count.textContent === "Matched 1 / 3", "Title reflects filtered results");
nodes.q.value = "zzz";
nodes.q.oninput();
ok(nodes.list.children.length === 1 && nodes.list.children[0].className === "empty", "Show empty state when no match exists");
nodes.q.value = "";
nodes.q.oninput();

// 3) Selecting a persona must preserve agents in options.set (original bug overwrote CLI configuration).
btn("\u4e2d\u6027\u52a9\u624b").onclick();
await tick();
const first = calls.at(-1);
ok(first.persona === "neutral", "Click writes persona");
ok(JSON.stringify(first.agents) === '["claude"]', "Agent filter is retained, not overwritten");
ok(first.mode === "append", "Unchanged mode is retained");

// 4) Changing mode must retain persona and agents
nodes.mode.value = "strict";
nodes.mode.onchange({ target: nodes.mode });
await tick();
const byMode = calls.at(-1);
ok(byMode.mode === "strict", "Changing mode updates options");
ok(byMode.persona === "neutral" && JSON.stringify(byMode.agents) === '["claude"]', "Persona and agents survive mode changes");

// 5) Two rapid clicks must retain the last one (original bug returned within 1.1s).
btn("ctf").onclick();
btn("\u4e2d\u6027\u52a9\u624b").onclick();
await tick();
ok(store.persona === "neutral", "Second rapid click wins");

// 6) Save failure must roll back rather than display false state.
failNext = true;
btn("ctf").onclick();
await tick();
ok(nodes.status.dataset.state === "error", "Failure marks status as error");
ok(nodes.status.textContent.includes("Save failed"), "Failure displays reason");
ok(nodes["now-persona"].textContent === "\u4e2d\u6027\u52a9\u624b", "Failure rolls UI back to saved values");

// 7) Import md: select file, fill id/name, save to options and select
const raw = "---\nname: \u6211\u7684\u4eba\u8bbe\ndescription: \u81ea\u6d4b\n---\nBe mine.";
nodes.file.files = [{ name: "my persona.md", text: async () => raw }];
await nodes.file.onchange({ target: nodes.file });
ok(nodes.body.value === raw, "File body enters text field");
ok(nodes.pname.value === "\u6211\u7684\u4eba\u8bbe", "Name comes from frontmatter");
ok(nodes.pid.value === "my-persona", "ID inferred from filename, replacing spaces with hyphens");

const beforeImport = calls.length;
nodes["import-save"].onclick();
await tick();
const imported = calls.at(-1);
ok(calls.length > beforeImport && imported.persona === "my-persona", "Select imported persona immediately");
ok(Array.isArray(imported.inlinePersonas) && imported.inlinePersonas[0]?.text === raw, "Write body to options.inlinePersonas");
ok(imported.inlinePersonas[0]?.name === "\u6211\u7684\u4eba\u8bbe", "Save the name for list display");
ok(nodes.list.children.length === 4 && textOf(nodes.list.children[0]).includes("\u6211\u7684\u4eba\u8bbe"), "Imported persona appears first");
ok(nodes.count.textContent === "All 4", "Title count includes imported persona");
ok(nodes["import-count"].textContent === "Imported 1", "Import count updates");
ok(nodes.body.value === "" && nodes.pid.value === "", "Clear form after saving");

// Reject duplicate built-in and invalid IDs without sending options.set.
const guarded = calls.length;
nodes.file.files = [{ name: "x.md", text: async () => "hi" }];
await nodes.file.onchange({ target: nodes.file });
nodes.pid.value = "terse";
nodes["import-save"].onclick();
ok(nodes["import-err"].hidden === false && nodes["import-err"].textContent.includes("conflicts"), "Reject a built-in persona name conflict");
nodes.pid.value = "../bad";
nodes["import-save"].onclick();
ok(nodes["import-err"].textContent.includes("ID"), "Reject invalid ID and explain rule");
ok(calls.length === guarded, "No options.set calls for rejected input");

// Deleting all imports resets the selected persona to follow, avoiding dangling IDs.
nodes["del-all"].onclick();
await tick();
const afterDelete = calls.at(-1);
ok(Array.isArray(afterDelete.inlinePersonas) && afterDelete.inlinePersonas.length === 0, "Delete all imports");
ok(afterDelete.persona === "", "Deleted persona is no longer selected");
ok(nodes["import-count"].textContent === "No imports yet", "Count returns to empty");

// 8) Agent scope configuration (all / selected / excluded)
ok(nodes["scope-include"].checked === true, "Initial nonempty options.agents selects included scope");
ok(nodes["agents-panel"].hidden === false, "Show agent panel in selected scope");
ok(nodes["agents-list"].children.length >= 9, "Common agents are preloaded");

// Switch to exclusion mode
nodes["scope-exclude"].onchange();
await tick();
const scopeExcludeCall = calls.at(-1);
ok(Array.isArray(scopeExcludeCall.agents) && scopeExcludeCall.agents.length === 0, "Switching to exclusion clears the agents allowlist");

// Select claude in exclusion mode
const claudeChip = nodes["agents-list"].children.find((c) => c.dataset?.agent === "claude");
ok(claudeChip !== undefined, "Claude option exists");
const claudeCb = claudeChip.children.find((k) => k.type === "checkbox");
claudeCb.checked = true;
claudeCb.onchange();
await tick();
const excludeClaudeCall = calls.at(-1);
ok(JSON.stringify(excludeClaudeCall.disabledAgents) === '["claude"]', "Selecting claude writes disabledAgents");
ok(nodes.status.textContent.includes("excluding claude"), "Status shows claude excluded");

// Add a custom agent
nodes["custom-agent"].value = "kilo";
nodes["add-agent-btn"].onclick();
await tick();
const addKiloCall = calls.at(-1);
ok(addKiloCall.disabledAgents.includes("kilo"), "Add custom agent kilo to disabledAgents");

// Switch to all agents
nodes["scope-all"].onchange();
await tick();
const scopeAllCall = calls.at(-1);
ok(scopeAllCall.agents.length === 0 && scopeAllCall.disabledAgents.length === 0, "All agents scope clears filters");
ok(nodes["agents-panel"].hidden === true, "All agents scope hides agent panel");
// 9) Disable interaction when options cannot be read, preventing clicks from overwriting agents with an empty base.
const nodes2 = Object.fromEntries(ids.map((id) => [id, new Node()]));
nodes2.status.hidden = true;
runInNewContext(appSrc, {
	magpie: {
		ready: Promise.resolve(),
		options: {
			async get() {
				throw new Error("offline");
			},
		},
	},
	document: { getElementById: (id) => nodes2[id], createElement: (tag) => new Node(tag) },
	Option,
	window,
	Promise,
	setTimeout: fakeSetTimeout,
	Date: { now: () => clock },
});
await tick();
ok(nodes2.status.hidden === false && nodes2.status.dataset.state === "error", "Display an error when options cannot be read");
ok(nodes2.list.children.length === 0 && nodes2.mode.onchange === undefined, "Render no personas or handlers when options cannot be read");

console.log(process.exitCode ? "\nSome checks failed" : `\nAll passed (${calls.length} options.set calls)`);
