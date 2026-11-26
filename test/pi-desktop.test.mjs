import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installPlugin, probePlugin, pluginDir, uninstallPlugin } from "../lib/pi-desktop.mjs";
import { extensionSource } from "../lib/extension.mjs";

// PI-Desktop extensions must be contributed by plugins: verify registry installation, complete files, and clean removal.
function sandbox(t) {
	const dir = mkdtempSync(join(tmpdir(), "ap-pidesk-"));
	const data = join(dir, "data");
	mkdirSync(join(data, "plugins"), { recursive: true });
	writeFileSync(join(data, "plugins", "registry.json"), "[]\n", "utf8");
	process.env.PI_DESKTOP_DATA_DIR = data;
	t.after(() => {
		delete process.env.PI_DESKTOP_DATA_DIR;
		rmSync(dir, { recursive: true, force: true });
	});
	return data;
}

const registryOf = (data) => JSON.parse(readFileSync(join(data, "plugins", "registry.json"), "utf8"));

test("pi-desktop: installing the plugin writes source, manifest, wrapper and registry entry", (t) => {
	const data = sandbox(t);
	const r = installPlugin("C:/ap-home");
	assert.ok(r.file, r.error);
	assert.equal(existsSync(r.file), true);
	assert.equal(existsSync(join(pluginDir(), "manifest.json")), true);
	assert.equal(existsSync(join(pluginDir(), "main.cjs")), true);

	const manifest = JSON.parse(readFileSync(join(pluginDir(), "manifest.json"), "utf8"));
	assert.deepEqual(manifest.contributes.agentExtensions, ["src/agent-purge.ts"]);
	assert.deepEqual(manifest.permissions, ["agent.extension"]);

	const entry = registryOf(data).find((p) => p.id === "imported.agent-purge");
	assert.ok(entry, "Missing registry entry");
	assert.equal(entry.enabled, true);
	assert.equal(entry.source, "dev");
	assert.equal(probePlugin(), true);
});

test("pi-desktop: uninstall removes the registry entry and plugin directory without touching other plugins", (t) => {
	const data = sandbox(t);
	// Another plugin directory and registry entry
	const foreign = join(data, "plugins", "imported", "someone-else");
	mkdirSync(foreign, { recursive: true });
	writeFileSync(join(foreign, "manifest.json"), JSON.stringify({ id: "imported.someone-else" }));
	writeFileSync(
		join(data, "plugins", "registry.json"),
		JSON.stringify([{ id: "imported.someone-else", enabled: true, path: foreign }], null, 2) + "\n",
	);

	installPlugin("C:/ap-home");
	assert.equal(registryOf(data).length, 2);
	const r = uninstallPlugin();
	assert.ok(r.removed.length >= 1);
	const left = registryOf(data);
	assert.deepEqual(left.map((p) => p.id), ["imported.someone-else"]);
	assert.equal(existsSync(pluginDir()), false);
	assert.equal(existsSync(foreign), true, "Another plugin directory was incorrectly removed");
	assert.equal(probePlugin(), false);
});

test("pi-desktop: missing registry produces an explicit error, not a silent partial install", (t) => {
	const data = sandbox(t);
	rmSync(join(data, "plugins", "registry.json"), { force: true });
	const r = installPlugin("C:/ap-home");
	assert.match(r.error ?? "", /registry/);
});

// PI-Desktop 0.21 sends before_agent_start results as mid-session system patches: models that do not recognize the patch
// (observed with mercury-3) see no change, while those that do (deepseek-v4.1-flash) can switch. Generated code must also set
// systemPromptOptions.forceSystemPrompt for full replacement to work across models.
test("pi-desktop: generated extension also writes the new prompt to forceSystemPrompt, including off cleanup", async (t) => {
	const dir = mkdtempSync(join(tmpdir(), "ap-pidesk-ext-"));
	const root = join(dir, "ap");
	mkdirSync(join(root, "personas"), { recursive: true });
	writeFileSync(join(root, "personas", "alpha.md"), "---\nid: alpha\n---\nALPHA PERSONA\n", "utf8");
	const state = (on) =>
		writeFileSync(
			join(root, "state.json"),
			JSON.stringify({
				v: 1,
				persona: "alpha",
				default: { harness: "pi-desktop", mode: "replace" },
				armed: on ? { "pi-desktop": ["slash"] } : {},
				"pi-desktopAuto": true,
				piAuto: false,
				ompAuto: false,
			}) + "\n",
			"utf8",
		);
	t.after(() => rmSync(dir, { recursive: true, force: true }));

	const source = extensionSource(root, "pi-desktop");
	assert.match(source, /forceSystemPrompt = finalPrompt/, "Generated code lacks forceSystemPrompt");
	const plugin = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
	const hooks = {};
	plugin.default({ on: (k, v) => (hooks[k] = v), registerCommand: () => {} });

	state(true);
	const event = { systemPrompt: "HOST PROMPT", systemPromptOptions: {} };
	const out = await hooks.before_agent_start(event);
	assert.match(String(out.systemPrompt), /ALPHA PERSONA/);
	assert.equal(event.systemPromptOptions.forceSystemPrompt, out.systemPrompt, "forceSystemPrompt differs from the returned prompt");

	state(false);
	const offEvent = { systemPrompt: "HOST PROMPT", systemPromptOptions: { forceSystemPrompt: "STALE" } };
	await hooks.before_agent_start(offEvent);
	assert.equal("forceSystemPrompt" in offEvent.systemPromptOptions, false, "off must remove forceSystemPrompt");
});
