import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityAgentsFile, installAntigravity, probeAntigravity, temporaryAntigravity, uninstallAntigravity } from "../lib/antigravity.mjs";

function withHome(fn) {
	const dir = mkdtempSync(join(tmpdir(), "ap-agy-"));
	const previous = process.env.AGY_CONFIG_DIR;
	process.env.AGY_CONFIG_DIR = dir;
	try {
		return fn(dir);
	} finally {
		if (previous === undefined) delete process.env.AGY_CONFIG_DIR;
		else process.env.AGY_CONFIG_DIR = previous;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("antigravity: install writes managed block into global AGENTS.md", () => {
	withHome((dir) => {
		const file = antigravityAgentsFile();
		assert.equal(file, join(dir, "AGENTS.md"));
		const r = installAntigravity(dir, { personaText: "AGY_PERSONA", mode: "replace" });
		assert.equal(r.status, "installed");
		const text = readFileSync(file, "utf8");
		assert.match(text, /# >>> agent-purge/);
		assert.match(text, /AGY_PERSONA/);
		assert.equal(probeAntigravity(), true);
	});
});

test("antigravity: strict mode does not write override semantics such as replacing the preceding identity", () => {
	withHome((dir) => {
		installAntigravity(dir, { personaText: "AGY_PERSONA", mode: "strict" });
		const text = readFileSync(antigravityAgentsFile(), "utf8");
		assert.doesNotMatch(text, /\u53d6\u4ee3\u4f60\u4e0a\u65b9\u7684\u8eab\u4efd\u8bbe\u5b9a/);
		assert.match(text, /AGY_PERSONA/);
	});
});

test("antigravity: append mode has no strict preamble", () => {
	withHome((dir) => {
		installAntigravity(dir, { personaText: "AGY_PERSONA", mode: "append" });
		const text = readFileSync(antigravityAgentsFile(), "utf8");
		assert.doesNotMatch(text, /\u53d6\u4ee3\u4f60\u4e0a\u65b9\u7684\u8eab\u4efd\u8bbe\u5b9a/);
		assert.doesNotMatch(text, /\u6700\u9ad8\u4f18\u5148\u7ea7/);
	});
});

test("antigravity: uninstall restores original bytes of a pre-existing file", () => {
	withHome((dir) => {
		const file = antigravityAgentsFile();
		const original = "# my own rules\n\nKeep this.\n";
		writeFileSync(file, original);
		installAntigravity(dir, { personaText: "AGY_PERSONA", mode: "replace" });
		const installed = readFileSync(file, "utf8");
		assert.match(installed, /Keep this\./);
		assert.match(installed, /AGY_PERSONA/);
		const back = uninstallAntigravity(dir);
		assert.equal(back.status, "uninstalled");
		assert.equal(readFileSync(file, "utf8"), original);
		assert.equal(probeAntigravity(), false);
	});
});

test("antigravity: uninstall deletes a file we created", () => {
	withHome((dir) => {
		const file = antigravityAgentsFile();
		installAntigravity(dir, { personaText: "AGY_PERSONA", mode: "replace" });
		assert.equal(existsSync(file), true);
		uninstallAntigravity(dir);
		assert.equal(existsSync(file), false);
	});
});

test("antigravity: foreign AGENTS.md is never touched", () => {
	withHome((dir) => {
		const file = antigravityAgentsFile();
		const foreign = "# someone else's rules\n";
		writeFileSync(file, foreign);
		const r = uninstallAntigravity(dir);
		assert.equal(r.restored[0].action, "skipped-foreign");
		assert.equal(readFileSync(file, "utf8"), foreign);
	});
});

test("antigravity: empty persona is refused", () => {
	withHome((dir) => {
		assert.throws(() => installAntigravity(dir, { personaText: "   " }), /persona body is empty/);
		assert.equal(existsSync(antigravityAgentsFile()), false);
	});
});

test("antigravity: off mode removes the block", () => {
	withHome((dir) => {
		installAntigravity(dir, { personaText: "AGY_PERSONA", mode: "replace" });
		installAntigravity(dir, { personaText: "AGY_PERSONA", mode: "off" });
		assert.equal(existsSync(antigravityAgentsFile()), false);
	});
});

test("antigravity: temporary install restores exact bytes and keeps a persistent block", () => {
	withHome((dir) => {
		const file = antigravityAgentsFile();
		installAntigravity(dir, { personaText: "PERSISTENT_PERSONA", mode: "replace" });
		const persistBytes = readFileSync(file, "utf8");
		const undo = temporaryAntigravity({ personaText: "TEMP_PERSONA", mode: "replace" });
		assert.match(readFileSync(file, "utf8"), /TEMP_PERSONA/);
		undo();
		const back = readFileSync(file, "utf8");
		assert.equal(back, persistBytes);
		assert.match(back, /PERSISTENT_PERSONA/);
		undo(); // idempotent
		assert.equal(readFileSync(file, "utf8"), persistBytes);
	});
});

test("antigravity: temporary install on a clean machine removes the file again", () => {
	withHome((dir) => {
		const file = antigravityAgentsFile();
		const undo = temporaryAntigravity({ personaText: "TEMP_ONLY", mode: "replace" });
		assert.equal(existsSync(file), true);
		undo();
		assert.equal(existsSync(file), false);
	});
});

test("antigravity: temporary install keeps the user's own rules intact", () => {
	withHome((dir) => {
		const file = antigravityAgentsFile();
		const original = "# user rules\n\nDo not lose this.\n";
		writeFileSync(file, original);
		const undo = temporaryAntigravity({ personaText: "TEMP_PERSONA", mode: "replace" });
		assert.match(readFileSync(file, "utf8"), /Do not lose this\./);
		undo();
		assert.equal(readFileSync(file, "utf8"), original);
	});
});
