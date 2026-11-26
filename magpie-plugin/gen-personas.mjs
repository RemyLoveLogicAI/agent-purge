// Generate page/personas.js: the plugin page cannot read disk or fetch, so the persona list is bundled statically.
//   node magpie-plugin/gen-personas.mjs     (rerun after adding or removing personas)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const env = process.env.AGENT_PURGE_HOME?.trim();
const home = !env ? join(homedir(), ".agent-purge") : isAbsolute(env) ? env : resolve(env);
const dir = join(home, "personas");

if (!existsSync(dir)) {
	console.error(`Persona directory not found: ${dir}${env ? `\nAGENT_PURGE_HOME=${env}` : ""}`);
	console.error("Run agent-purge web (or agent-purge ls) once to generate personas; check AGENT_PURGE_HOME if the path is incorrect.");
	process.exit(1);
}

const field = (fm, k) =>
	fm
		.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]
		?.trim()
		.replace(/^["']|["']$/g, "") ?? "";

const list = readdirSync(dir)
	.filter((f) => f.endsWith(".md") && f !== "active.md") // active.md is agent-purge’s synchronized copy, not a selectable persona
	.map((f) => {
		const fm = readFileSync(join(dir, f), "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
		return { id: field(fm, "id") || f.replace(/\.md$/, ""), name: field(fm, "name"), description: field(fm, "description") };
	})
	.sort((a, b) => a.id.localeCompare(b.id));

writeFileSync(new URL("./page/personas.js", import.meta.url), `window.PERSONAS = ${JSON.stringify(list, null, "\t")};\n`);
console.log(`personas.js ← ${list.length} entries: ${list.map((p) => p.id).join(", ")}`);
