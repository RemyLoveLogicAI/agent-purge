import { isolate } from "./isolate.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ap-ledger-"));
isolate(dir);
Object.assign(process.env, { HOME: dir, USERPROFILE: dir, AGENT_PURGE_HOME: join(dir, "data") });
const { cancel, ledgerFile, listLedger, record } = await import("../lib/footprints.mjs");
const { clean } = await import("../lib/clean.mjs");
const { dataHome } = await import("../lib/home.mjs");
test.after(() => rmSync(dir, { recursive: true, force: true }));

test("Ledger: deduplicate by owner; preserve evidence and stop writes when corrupted", () => {
	const root = join(dir, "l1");
	const file = join(dir, "a.txt");
	writeFileSync(file, "x");
	record(root, { kind: "file", harness: "codex", channel: "shim", path: file, undo: { type: "file-delete" } });
	record(root, { kind: "file", harness: "codex", channel: "shim", path: file, undo: { type: "file-delete" } });
	assert.equal(listLedger(root).length, 1, "Duplicate registrations must be deduplicated");
	cancel(root, { kind: "file", path: file });
	assert.equal(listLedger(root).length, 0);
	writeFileSync(ledgerFile(root), "{not json");
	assert.throws(() => listLedger(root), /Footprint ledger is corrupt/);
	assert.throws(() => record(root, { kind: "file", harness: "pi", channel: "shim", path: file, undo: { type: "file-delete" } }), /Footprint ledger is corrupt/);
	assert.equal(readFileSync(ledgerFile(root), "utf8"), "{not json");
});

test("Ledger: a directory registered as a path must not be read as a file", () => {
	const root = join(dir, "l-path");
	const folder = join(dir, "shim-bin");
	mkdirSync(folder, { recursive: true });
	const entry = record(root, { kind: "path", harness: "codebuddy", channel: "shim", path: folder, undo: { type: "path-env" } });
	assert.equal(entry.kind, "path");
	assert.equal(entry.sha256, undefined, "Directories have no file hash");
	assert.equal(listLedger(root).length, 1);
	cancel(root, { kind: "path", path: folder });
	assert.equal(listLedger(root).length, 0);
});

test("Clean: remove ledger files and managed blocks, preserving outside content", () => {
	const root = join(dir, "l2");
	mkdirSync(root, { recursive: true });
	const victim = join(dir, "victim.md");
	const agentFile = join(dir, "AGENTS.md");
	writeFileSync(victim, "shim");
	writeFileSync(agentFile, "MINE\n# >>> agent-purge\ninjected block\n# <<< agent-purge\n");
	record(root, { kind: "file", harness: "codex", channel: "shim", path: victim, undo: { type: "file-delete" } });
	record(root, { kind: "block", harness: "pi", channel: "install", path: agentFile, undo: { type: "block-revert" } });

	const r = clean(root);
	assert.equal(existsSync(victim), false, "file-delete must remove the written file");
	const after = readFileSync(agentFile, "utf8");
	assert.ok(after.includes("MINE"), "Content outside the block must survive undo");
	assert.ok(!after.includes("injected block"), "Managed block must be removed");
	assert.equal(listLedger(root).length, 0, "Ledger must be empty after undo");
	assert.deepEqual(r.leftovers, []);
});

test("clean --dry-run: write nothing (files, managed blocks and ledger unchanged)", () => {
	const root = join(dir, "l4");
	mkdirSync(root, { recursive: true });
	const victim = join(dir, "dry-victim.md");
	const agentFile = join(dir, "dry-AGENTS.md");
	writeFileSync(victim, "shim");
	writeFileSync(agentFile, "MINE\n# >>> agent-purge\ninjected block\n# <<< agent-purge\n");
	record(root, { kind: "file", harness: "codex", channel: "shim", path: victim, undo: { type: "file-delete" } });
	record(root, { kind: "block", harness: "pi", channel: "install", path: agentFile, undo: { type: "block-revert" } });
	const snapshot = () => [readFileSync(victim, "utf8"), readFileSync(agentFile, "utf8"), readFileSync(ledgerFile(root), "utf8")];
	const before = snapshot();

	const r = clean(root, { dryRun: true });

	assert.deepEqual(snapshot(), before, "dry-run changed bytes; it must be read-only");
	assert.equal(listLedger(root).length, 2, "dry-run must not clear the ledger or real clean will miss remnants");
	assert.equal(r.ok, true);
	assert.ok(r.steps.some((s) => String(s.detail).includes("dry-run")), "Steps must explicitly identify the dry run");
});

test("self-uninstall: remove the data directory; refuse when it is cwd", () => {
	const root = join(dir, "l3");
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "state.json"), "{}");
	const prev = process.env.AGENT_PURGE_HOME;
	process.env.AGENT_PURGE_HOME = root;
	try {
		assert.equal(dataHome(), root);
		clean(root, { all: true });
		assert.equal(existsSync(root), false, "all=true must remove the entire data directory");

		// Refuse when data directory equals cwd: that would delete the user’s own directory.
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "state.json"), "{}");
		const realCwd = process.cwd;
		process.cwd = () => root;
		try {
			const r = clean(root, { all: true });
			assert.equal(existsSync(join(root, "state.json")), true, "cwd protection must prevent deletion");
			assert.equal(r.ok, false, "Refusal must be reported as incomplete, not silent success");
		} finally {
			process.cwd = realCwd;
		}
	} finally {
		process.env.AGENT_PURGE_HOME = prev;
	}
});
