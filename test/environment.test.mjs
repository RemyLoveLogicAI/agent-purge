import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isolatedEnv } from "../lib/environment.mjs";
import { defaultSources } from "../lib/locate.mjs";

const sandbox = (t) => {
	const root = mkdtempSync(join(tmpdir(), "ap-env-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	return root;
};

test("isolatedEnv: passes ELECTRON_RUN_AS_NODE through under Electron embedded Node", (t) => {
	// When process.execPath is an Electron helper, child processes without this variable fail to start with exit code 64,
	// breaking all CLI subprocesses in tests and real host captures.
	const root = sandbox(t);
	const env = isolatedEnv(root, { PATH: "/usr/bin" });
	assert.equal(env.ELECTRON_RUN_AS_NODE, undefined, "A plain Node environment must not invent this variable");

	const electron = isolatedEnv(root, { PATH: "/usr/bin", ELECTRON_RUN_AS_NODE: "1" });
	assert.equal(electron.ELECTRON_RUN_AS_NODE, "1");
	// Passing this through does not admit other variables: isolation still uses an allowlist.
	assert.equal(isolatedEnv(root, { ELECTRON_RUN_AS_NODE: "1", SECRET_TOKEN: "x" }).SECRET_TOKEN, undefined);
});

test("isolatedEnv: HOME is still redirected to the sandbox without leaking the real user directory", (t) => {
	const root = sandbox(t);
	const env = isolatedEnv(root, { HOME: "/real/home", ELECTRON_RUN_AS_NODE: "1" });
	assert.equal(env.HOME, join(root, "home"));
	assert.equal(env.USERPROFILE, join(root, "home"));
});

test("defaultSources: AGENT_PURGE_APP_DIRS can override macOS /Applications", (t) => {
	const root = sandbox(t);
	const saved = process.env.AGENT_PURGE_APP_DIRS;
	t.after(() => {
		if (saved === undefined) delete process.env.AGENT_PURGE_APP_DIRS;
		else process.env.AGENT_PURGE_APP_DIRS = saved;
	});

	delete process.env.AGENT_PURGE_APP_DIRS;
	assert.equal(defaultSources(root).appDirs, undefined, "Use the platform default when no override is set");

	process.env.AGENT_PURGE_APP_DIRS = `${join(root, "A")}; ${join(root, "B")};`;
	assert.deepEqual(defaultSources(root).appDirs, [join(root, "A"), join(root, "B")]);
});
