import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "ap-home-migrate-"));
const saved = { ...process.env };
process.env.HOME = dir;
process.env.USERPROFILE = dir;
delete process.env.AGENT_PURGE_HOME;
const { ensureDataHome } = await import("../lib/home.mjs");

test.after(() => {
	process.env = saved;
	rmSync(dir, { recursive: true, force: true });
});

test("home: migrate state, personas, ledger and stash together from the old package directory", () => {
	const pkg = join(dir, "pkg");
	mkdirSync(join(pkg, "personas"), { recursive: true });
	mkdirSync(join(pkg, "stash"), { recursive: true });
	writeFileSync(join(pkg, "state.json"), JSON.stringify({ version: 1, state: {} }));
	writeFileSync(join(pkg, "personas", "alpha.md"), "PERSONA_ALPHA");
	writeFileSync(join(pkg, "footprints.json"), JSON.stringify({ version: 1, entries: [] }));
	writeFileSync(join(pkg, "stash", "a.json"), JSON.stringify({ file: "AGENTS.md" }));

	const result = ensureDataHome(pkg);
	const home = join(dir, ".agent-purge");
	assert.deepEqual(result.migrated.length, 4);
	assert.equal(readFileSync(join(home, "state.json"), "utf8"), JSON.stringify({ version: 1, state: {} }));
	assert.equal(readFileSync(join(home, "personas", "alpha.md"), "utf8"), "PERSONA_ALPHA");
	assert.equal(readFileSync(join(home, "footprints.json"), "utf8"), JSON.stringify({ version: 1, entries: [] }));
	assert.equal(readFileSync(join(home, "stash", "a.json"), "utf8"), JSON.stringify({ file: "AGENTS.md" }));
	assert.equal(existsSync(join(pkg, "state.json")), true, "old files remain as backups");
});
