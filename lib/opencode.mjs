// Both OpenCode API generations share enable and undo logic; temporary plugins accept only credentials issued by the parent process.
import { join } from "node:path";
import { personaBodyRuntime, resolveRuntime, rewriteRuntime } from "./rewrite.mjs";
import { launchRuntime } from "./launch.mjs";

export function opencodeSource(root, harness, { temporary = false, active = join(root, "personas", "active.md") } = {}) {
	const common = `// agent-purge managed file; ${temporary ? "only for this explicit launch" : "persistent configuration"}，check live state every turn.
import { readFileSync } from "node:fs";
const HOME = ${JSON.stringify(root)};
const STATE = HOME + "/state.json";
const PERSONAS = HOME + "/personas";
const ACTIVE = ${JSON.stringify(active)};
const HARNESS = ${JSON.stringify(harness)};
const TEMPORARY = ${temporary};
${rewriteRuntime}
${resolveRuntime}
${personaBodyRuntime}
${launchRuntime}
function cfg() {
  try {
    const st = JSON.parse(readFileSync(STATE, "utf8"));
    const lease = readLaunch(HOME, st, HARNESS);
    if (TEMPORARY ? !lease || lease.writer !== "temporary" : lease?.writer === "temporary") return null;
    const c = resolveActivation(st, HARNESS, { channel: "install", launch: TEMPORARY && !!lease,
      mode: TEMPORARY ? lease?.mode : undefined, persona: TEMPORARY ? lease?.persona : undefined });
    if (!c.on) return null;
    const body = resolvePersonaBody(PERSONAS, c.persona, ACTIVE);
    return body ? { mode: c.mode, body } : null;
  } catch { return null; }
}
const sessions = new Map();
function rewriter(id) {
  const key = id ?? "default";
  if (!sessions.has(key)) sessions.set(key, ${harness === "opencode" ? "createTextRewriter" : "createContentRewriter"}());
  while (sessions.size > 64) sessions.delete(sessions.keys().next().value);
  return sessions.get(key);
}
`;
	if (harness === "opencode") return common + `
export const AgentPurge = async () => {
  const transform = async (input, output) => {
    if (!Array.isArray(output.system)) return;
    const c = cfg();
    const next = rewriter(input?.sessionID)(output.system, c?.body || "", c?.mode || "off");
    if (JSON.stringify(next) !== JSON.stringify(output.system)) output.system.splice(0, output.system.length, ...next);
  };
  return {
    "chat.system.transform": transform,
    "experimental.chat.system.transform": transform,
  };
};
`;
	return common + `
export default {
  id: ${JSON.stringify(temporary ? "agent-purge-v2-session" : "agent-purge")},
  async setup(ctx) {
    await ctx.session.hook("context", event => {
      if (!Array.isArray(event.system)) return;
      const c = cfg();
      const next = rewriter(event.sessionID ?? event.session?.id)(event.system, c?.body || "", c?.mode || "off");
      if (JSON.stringify(next) !== JSON.stringify(event.system)) event.system.splice(0, event.system.length, ...next);
    });
  },
};
`;
}
