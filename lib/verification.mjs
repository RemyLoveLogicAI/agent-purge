// Read verification evidence showing which harnesses actually passed the persona into a privileged role.
// Use only verification/latest.json from local capture, not matrix.json constants or a successful configuration write.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verificationEvidence } from "./evidence.mjs";
export { sysHit } from "./evidence.mjs";

export function verificationFile(root) {
	return join(root, "verification", "latest.json");
}

/** Harness name → true when verified in the system layer. No report means an empty set; callers treat it as untested. */
export function verifiedHarnesses(root) {
	const ok = new Set();
	let raw;
	try {
		raw = JSON.parse(readFileSync(verificationFile(root), "utf8"));
	} catch {
		return ok;
	}
	for (const r of Array.isArray(raw?.results) ? raw.results : []) if (verificationEvidence(r).state === "verified") ok.add(r.harness);
	return ok;
}
