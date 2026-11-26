// pi and omp share a generator; source and generated runtime share activation, locking, and provenance tracking.
import { resolveRuntime, rewriteRuntime } from "./rewrite.mjs";
import { launchRuntime } from "./launch.mjs";
import { controlRuntime } from "./control.mjs";

export function extensionSource(root, harness) {
	return `// agent-purge managed extension: reads configuration each turn; reload after first installation or update.
import { readFileSync } from "node:fs";
${controlRuntime}
const HOME = ${JSON.stringify(root)};
const STATE = HOME + "/state.json";
const PERSONAS = HOME + "/personas/";
const HARNESS = ${JSON.stringify(harness)};
const AUTO = HARNESS + "Auto";
${rewriteRuntime}
${resolveRuntime}
${launchRuntime}
function readState() {
  try {
    const st = JSON.parse(readFileSync(STATE, "utf8"));
    return st && typeof st === "object" && !Array.isArray(st) ? st : null;
  } catch { return null; }
}
function loadPersona(id) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id || "") || id === "active") return { id: null, body: "" };
  try {
    const raw = readFileSync(PERSONAS + id + ".md", "utf8").replace(/^---\\r?\\n[\\s\\S]*?\\r?\\n---(?:\\r?\\n|$)/, "");
    return { id, body: raw.trim() };
  } catch { return { id, body: "" }; }
}
export default function agentPurge(api) {
  let forced = null, explicitMode = null, commandEpoch = null;
  let rewrite = createTextRewriter();
  let messageRecords = new Map(), generated = createProvenance(), bridge = null, lastCwd = "";
  function cwdOf(event) {
    return String(event?.systemPromptOptions?.cwd ?? process.cwd()).replace(/\\\\/g, "/");
  }
  function interpolatePersona(text, cwd) {
    if (!text || !text.includes("{{cwd}}")) return text;
    return cwd ? text.split("{{cwd}}").join(cwd) : text.replace(/[ \\t]*\\{\\{cwd\\}\\}[ \\t]*/g, " ").replace(/[ \\t]+\\n/g, "\\n");
  }
  function config() {
    const raw = readState();
    // PI-Desktop has no separate auto-apply switch; reuse piAuto, state, and personas from pi.
    const st = HARNESS === "pi-desktop" && raw && raw["pi-desktopAuto"] === undefined
      ? { ...raw, "pi-desktopAuto": raw.piAuto === true } : raw;
    const launch = readLaunch(HOME, st, HARNESS);
    const epoch = (st?.activationEpoch || "initial") + ":" + (st?.harnessEpochs?.[HARNESS] || "initial");
    if (commandEpoch && commandEpoch !== epoch) { forced = null; explicitMode = null; commandEpoch = null; }
    const c = resolveActivation(st, HARNESS, { channel: "slash", session: forced, launch: !!launch,
      mode: explicitMode || launch?.mode, persona: launch?.persona });
    // When CLI arguments already inject, this process’s persistent extension only undoes its own previous output.
    if (launch?.writer === "cli") c.on = false;
    const persona = loadPersona(c.persona);
    return { ...c, st, ...persona, on: c.on && !!persona.body, epoch };
  }
  function recordFor(msg, index) {
    const key = msg.role + ":" + (msg.id ?? msg.timestamp ?? index);
    if (!messageRecords.has(key)) messageRecords.set(key, createProvenance());
    while (messageRecords.size > 64) messageRecords.delete(messageRecords.keys().next().value);
    return messageRecords.get(key);
  }
  api.on("session_start", async () => {
    forced = null; explicitMode = null; commandEpoch = null;
    rewrite = createTextRewriter(); messageRecords = new Map(); generated = createProvenance(); bridge = null;
  });
  api.on("before_agent_start", async event => {
    const c = config();
    const cwd = cwdOf(event);
    lastCwd = cwd;
    const persona = c.on ? interpolatePersona(c.body, cwd) : "";
    const input = Array.isArray(event.systemPrompt) ? event.systemPrompt : [event.systemPrompt ?? ""];
    const restored = rewrite(input, "", "off");
    let next = rewrite(input, persona, c.on ? c.mode : "off");
    if (!c.on) {
      const list = Array.isArray(next) ? next : [next];
      next = list.map(t => typeof t === "string" && t.includes("# >>> agent-purge") ? cleanManaged(t) : t);
    }
    const finalPrompt = HARNESS === "omp" ? next : (Array.isArray(next) ? next : [next]).join("\\n\\n");
    if (c.on) bridge = { before: restored.join("\\n\\n"), after: (Array.isArray(next) ? next : [next]).join("\\n\\n") };
    // PI-Desktop 0.21 sends before_agent_start results as mid-session system patches: models that accept patches switch,
    // while those that do not (observed with mercury-3) see no change. forceSystemPrompt replaces the full prompt in upstream pi
    // (not listed in PI-Desktop specs but passed through by the adapter). Keep both paths in case pass-through fails.
    // Handle this before the no-change return below, or disabling cannot undo the previous forced prompt.
    if (HARNESS === "pi-desktop" && event?.systemPromptOptions) {
      if (c.on) event.systemPromptOptions.forceSystemPrompt = finalPrompt;
      else delete event.systemPromptOptions.forceSystemPrompt;
    }
    if (!c.on && event?.systemPromptOptions && finalPrompt === event.systemPrompt) return;
    return { systemPrompt: finalPrompt };
  });
  if (HARNESS === "pi") {
    try {
      api.on("context_with_system", async event => {
        if (!Array.isArray(event.messages)) return;
        const c = config(), messages = event.messages;
        // Delete only complete provenance-matched messages generated by this session, not host or user labels with matching names.
        for (let i = messages.length - 1; i >= 0; i--) if (generated.restore(messages[i]) === null) messages.splice(i, 1);
        for (let i = 0; i < messages.length; i++) {
          const msg = messages[i];
          if (msg.role !== "system" && msg.role !== "user") continue;
          const provenance = recordFor(msg, messages.slice(0, i).filter(m => m.role === msg.role).length);
          let host = provenance.restore(msg.content);
          if (msg.role === "system" && bridge) {
            if (host === bridge.after) host = bridge.before;
            else if (Array.isArray(host)) host = host.map(b => b?.text === bridge.after ? { ...b, text: bridge.before } : b);
          }
          let next = host;
          const persona = c.on ? interpolatePersona(c.body, lastCwd || cwdOf({})) : "";
          if (msg.role === "system") {
            if (c.on) {
              next = typeof host === "string" ? rewriteTexts([host], persona, c.mode).join("\\n\\n") : createContentRewriter()(host, persona, c.mode);
            } else if (typeof host === "string" && host.includes("# >>> agent-purge")) {
              next = cleanManaged(host);
            }
          }
          msg.content = provenance.remember(host, next);
        }
        if (c.on && !messages.some(m => m.role === "system")) {
          const own = { role: "system", content: interpolatePersona(c.body, lastCwd || cwdOf({})) };
          generated.remember(null, own); messages.unshift(own);
        }
        if (c.on && c.st.piUserLayer) {
          const index = messages.findLastIndex(m => m.role === "user");
          if (index >= 0) {
            const msg = messages[index], provenance = recordFor(msg, messages.slice(0, index).filter(m => m.role === msg.role).length);
            const host = provenance.restore(msg.content);
            const prefix = "<agent-purge>\\n" + interpolatePersona(c.body, lastCwd || cwdOf({})) + "\\n</agent-purge>\\n\\n";
            const next = typeof host === "string" ? prefix + host : [{ type: "text", text: prefix }, ...(Array.isArray(host) ? host : [])];
            msg.content = provenance.remember(host, next);
          }
        }
      });
    } catch { /* Older hosts support only before_agent_start */ }
  }
  api.registerCommand("purge", {
    description: "Session toggle, persona and mode (following agent-purge configuration)",
    getArgumentCompletions: prefix => ["on", "off", "always", "status", "reload", "mode"].filter(v => v.startsWith(prefix)).map(value => ({ value, label: value })),
    handler: async (args, ctx) => {
      const [cmd = "", want] = String(args).trim().split(/\\s+/);
      const tell = (text, level = "info") => ctx.ui.notify(text, level);
      const c = config();
      const summary = "Status: " + (c.on ? "on" : "off") + "\\nMode: " + c.mode + "\\nPersona: " + (c.id || "unset") + "\\nActivation source: " + (c.source || c.blockedBy || "none") + "\\nConfiguration: " + STATE;
      if (cmd === "status") return tell(summary);
      if (cmd === "reload") return tell("Reloaded current configuration and persona (read automatically each turn; no restart needed)\\n" + summary);
      if (cmd === "off" || (!cmd && c.on)) { forced = false; commandEpoch = c.epoch; return tell("Disabled for this session; provenance-tracked content will be undone next turn"); }
      if (cmd === "on" || !cmd) {
        const activation = resolveActivation(c.st, HARNESS, { channel: "slash", session: true });
        if (!activation.on) return tell("Not currently enabled: " + activation.blockedBy, "error");
        if (!c.body) return tell("No persona available", "error");
        forced = true; commandEpoch = c.epoch;
        return tell("Enabled for this session; the current persona will be read next turn");
      }
      if (cmd === "mode") {
        if (!["strict", "replace", "append"].includes(want)) return tell("Usage: /purge mode strict|replace|append", "error");
        explicitMode = want; commandEpoch = c.epoch;
        return tell("Session mode → " + want + "; pause and harness disablement still take precedence");
      }
      if (cmd === "always") {
        if (!["on", "off"].includes(want)) return tell("Usage: /purge always on|off", "error");
        try {
          withControlLock(HOME, () => {
            const st = readState(); if (!st) throw new Error("Configuration missing or corrupt");
            atomicControlJSON(STATE, { ...st, [AUTO]: want === "on" });
          });
          return tell("Auto-apply on bare launch → " + want + "; channel selection and pause remain unchanged");
        } catch (e) { return tell(e.message, "error"); }
      }
      tell("Usage: /purge [on|off|status|reload|mode strict|replace|append|always on|off]", "error");
    },
  });
}
`;
}
