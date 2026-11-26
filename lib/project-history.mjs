// Project rules page action history: records only successful and failed Web attempts; it does not affect installation state.
// A separate JSONL file keeps audit records out of state.json and the footprint ledger.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const pathKey = path => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const historyFile = root => join(root, "project-history.jsonl");

export function appendProjectHistory(root, entry) {
	if (!root || !entry?.dir) return null;
	mkdirSync(root, { recursive: true });
	const row = { at: new Date().toISOString(), ...entry };
	appendFileSync(historyFile(root), JSON.stringify(row) + "\n", "utf8");
	return row;
}

export function readProjectHistory(root, dir, limit = 20) {
	if (!root || !dir || !existsSync(historyFile(root))) return [];
	try {
		const rows = readFileSync(historyFile(root), "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.map(line => JSON.parse(line))
			.filter(row => row && typeof row.dir === "string" && pathKey(row.dir) === pathKey(dir));
		return rows.reverse().slice(0, limit);
	} catch {
		return [];
	}
}
