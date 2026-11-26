import { isolate } from "./isolate.mjs";
// Hermes interactive launch: write SOUL.md → restore on exit; retain --ignore-rules or built-in rules override the persona.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "purge-backends-"));
const home = join(dir, "home");
const data = join(dir, "data");
mkdirSync(join(home, "hermes"), { recursive: true });
const soul = join(home, "hermes", "SOUL.md");
const persona = join(dir, "persona.md");
writeFileSync(persona, "\u4f60\u662f pi，\u4e0d\u662f Hermes。\n");
const original = "\u539f\u59cb\u4eba\u8bbe：\u6211\u662f Hermes\n";
writeFileSync(soul, original);

const saved = { ...process.env };
isolate(dir);
Object.assign(process.env, {
	HOME: home,
	USERPROFILE: home,
	HERMES_HOME: join(home, "hermes"),
	AGENT_PURGE_HOME: data,
});

const { backends, oneshots } = await import("../backends/index.mjs");
const { setArmed } = await import("../lib/state.mjs");

const spec = (mode, args = []) => backends.hermes({ personaPath: persona, mode, args, root: data });

test("Hermes launch includes --ignore-rules; off mode neither adds it nor writes files", () => {
	assert.deepEqual(spec("replace", ["--resume"]).args, ["--ignore-rules", "--resume"]);
	const off = spec("off", ["-x"]);
	assert.deepEqual(off.args, ["-x"]);
	off.setup();
	off.cleanup();
	assert.equal(readFileSync(soul, "utf8"), original);
});

test("setup writes SOUL.md and cleanup restores pre-installation bytes", () => {
	const s = spec("replace");
	s.setup();
	assert.match(readFileSync(soul, "utf8"), /\u4f60\u662f pi，\u4e0d\u662f Hermes。/);
	s.cleanup();
	assert.equal(readFileSync(soul, "utf8"), original);
});

test("Temporary launch restores original bytes on exit even with persistent selection, without leaving the temporary persona globally", () => {
	setArmed(data, "hermes", "install", true);
	const s = spec("replace");
	s.setup();
	assert.match(readFileSync(soul, "utf8"), /\u4f60\u662f pi，\u4e0d\u662f Hermes。/);
	s.cleanup();
	assert.equal(readFileSync(soul, "utf8"), original);
	setArmed(data, "hermes", "install", false);
});
test("Hermes --ask uses the same temporary SOUL lifecycle", () => {
	const s = oneshots.hermes({ prompt: 'QUESTION', personaText: 'ASK_PERSONA', mode: 'append' });
	assert.deepEqual(s.args, ['--ignore-rules', '-z', 'QUESTION']);
	s.setup(); assert.equal(readFileSync(soul, 'utf8'), original + '\n\nASK_PERSONA');
	s.cleanup(); assert.equal(readFileSync(soul, 'utf8'), original);
});

test.after(() => {
	Object.assign(process.env, saved);
	rmSync(dir, { recursive: true, force: true });
});
