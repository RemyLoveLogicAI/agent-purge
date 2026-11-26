import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { userHome } from "./paths.mjs";
import { swapFile } from "./restore.mjs";

// Kiro custom agents use the prompt as the main session system prompt; files are identified by name.
export const AGENT_NAME = "agent-purge";

export function kiroHome() {
	return process.env.KIRO_HOME ? resolve(process.env.KIRO_HOME) : join(userHome(), ".kiro");
}

export function kiroAgentFile() {
	return join(kiroHome(), "agents", `${AGENT_NAME}.json`);
}

export function kiroAgentSource(personaText) {
	return JSON.stringify({
		name: AGENT_NAME,
		description: "agent-purge managed persona",
		prompt: String(personaText ?? "").trim(),
	}, null, 2) + "\n";
}

/** Write only for this launch; return an undo that restores the original bytes. */
export function temporaryKiroAgent({ personaText }) {
	const file = kiroAgentFile();
	mkdirSync(join(file, ".."), { recursive: true });
	return swapFile(file, kiroAgentSource(personaText));
}
