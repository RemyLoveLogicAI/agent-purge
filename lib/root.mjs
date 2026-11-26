// Bundled resource access: source checkouts read disk; bun --compile builds use an embedded table.
//
// Why not compute one ROOT and join: observed on bun 1.3.14 for Windows
//   - `[dir]/[name].[ext]` naming turns root files into `B:/~BUN/root/./matrix.json`; readFileSync returns ENOENT;
//   - the joined path `B:/~BUN/root/matrix.json` cannot be opened either;
//   - bunfs directories do not support readdir.
// Only paths returned directly by import can be read, so the build entry generates a table of compiled paths,
// keyed by repository-relative POSIX paths. Source mode retains join(package root, relative path).
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILES = globalThis.__AGENT_PURGE_FILES ?? null;

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Compiled resources in bunfs are read-only; skip any writes to the package directory. */
export const isCompiled = () => FILES !== null;

/** Read a bundled resource by repository-relative POSIX path: matrix.json / web/ui.html / lib/templates/... */
export function readResource(rel) {
	const hit = FILES?.[rel];
	if (hit) return readFileSync(hit);
	if (FILES) throw new Error(`${rel} is not embedded in the executable (scripts/build-exe.mjs assets() omitted it)`);
	return readFileSync(join(ROOT, rel));
}

/** List files in a resource directory, excluding subdirectories: filter the embedded table in compiled mode or read the directory in source mode. */
export function listResources(prefix) {
	const dir = prefix.endsWith("/") ? prefix : `${prefix}/`;
	if (FILES) {
		return Object.keys(FILES)
			.filter((k) => k.startsWith(dir) && !k.slice(dir.length).includes("/"))
			.map((k) => k.slice(dir.length));
	}
	return readdirSync(join(ROOT, dir));
}
