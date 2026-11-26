// User data directory: state.json and personas/ live separately from the code.
//
// npm upgrades replace the entire package directory, so personas stored there would be deleted.
// Code uses ROOT regardless of installation location; data uses HOME:
//   AGENT_PURGE_HOME explicitly set > ~/.agent-purge
//
// On first run, copy the old layout from the package directory and preserve originals as backups.
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function dataHome() {
	const env = process.env.AGENT_PURGE_HOME?.trim();
	if (!env) return join(homedir(), ".agent-purge");
	return isAbsolute(env) ? env : resolve(env);
}

/**
 * Ensure the data directory exists and migrate the old layout.
 * @returns {{ home: string, migrated: string[] }}
 */
export function ensureDataHome(pkgRoot = null) {
	const home = dataHome();
	mkdirSync(home, { recursive: true });
	const migrated = [];
	// explicitly set AGENT_PURGE_HOME = a user-selected new home; do not migrate old data into it
	if (!pkgRoot || process.env.AGENT_PURGE_HOME?.trim() || resolve(pkgRoot) === resolve(home)) {
		return { home, migrated };
	}

	const state = [join(pkgRoot, "state.json"), join(home, "state.json")];
	if (existsSync(state[0]) && !existsSync(state[1])) {
		copyFileSync(state[0], state[1]);
		migrated.push(`state: ${state[0]} → ${state[1]}`);
	}

	const from = join(pkgRoot, "personas");
	const to = join(home, "personas");
	if (existsSync(from) && !existsSync(to)) {
		const md = readdirSync(from).filter((f) => f.endsWith(".md"));
		if (md.length) {
			cpSync(from, to, { recursive: true });
			migrated.push(`personas: ${from} → ${to} (${md.length} entries)`);
		}
	}

	// Migrate the ledger and original-byte backups as well; otherwise managed project blocks remain on disk
	// but the new version cannot find the undo baseline or guarantee restoration.
	const ledger = [join(pkgRoot, "footprints.json"), join(home, "footprints.json")];
	if (existsSync(ledger[0]) && !existsSync(ledger[1])) {
		copyFileSync(ledger[0], ledger[1]);
		migrated.push(`footprints: ${ledger[0]} → ${ledger[1]}`);
	}
	const stashFrom = join(pkgRoot, "stash");
	const stashTo = join(home, "stash");
	if (existsSync(stashFrom) && !existsSync(stashTo)) {
		cpSync(stashFrom, stashTo, { recursive: true });
		migrated.push(`stash: ${stashFrom} → ${stashTo}`);
	}
	return { home, migrated };
}
