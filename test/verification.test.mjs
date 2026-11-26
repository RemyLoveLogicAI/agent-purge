import "./isolate.mjs";
// Verification evidence requires a capture report: documentation constants do not count, nor does a marker outside the system/developer role.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sysHit, verifiedHarnesses, verificationFile } from "../lib/verification.mjs";
import { verificationEvidence, captureScopeLabel } from "../lib/evidence.mjs";

const report = (results) => ({ id: "r1", at: "2026-10-31T00:00:00.000Z", results });
const mode = (roles, markerCount) => ({ mode: "replace", status: "captured", exitCode: 0, requests: [{ roles, chars: 100, markerCount, identityLines: [], toolDefinitions: 3 }] });

function withRoot(fn) {
	const root = mkdtempSync(join(tmpdir(), "purge-verify-"));
	try {
		mkdirSync(join(root, "verification"), { recursive: true });
		return fn(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test("sysHit recognizes persona hits only in the system/developer role", () => {
	assert.equal(sysHit({ modes: [mode(["system"], 1)] }), true);
	assert.equal(sysHit({ modes: [mode(["developer"], 2)] }), true);
	assert.equal(sysHit({ modes: [mode(["user"], 3)] }), false);
	assert.equal(sysHit({ modes: [mode(["system"], 0)] }), false);
	assert.equal(sysHit({ modes: [] }), false);
	assert.equal(sysHit(undefined), false);
});

test("verifiedHarnesses returns an empty set when no report exists, without optimistic assumptions", () => {
	withRoot((root) => {
		assert.equal(verifiedHarnesses(root).size, 0);
	});
});

test("verifiedHarnesses includes only captured hits, excluding user-only hits", () => {
	withRoot((root) => {
		writeFileSync(verificationFile(root), JSON.stringify(report([
			{ harness: "pi", status: "captured", modes: [mode(["system"], 1)] },
			{ harness: "zcode", status: "captured", modes: [mode(["user"], 1)] },
			{ harness: "codex", status: "missing", modes: [] },
		])));
		const ok = verifiedHarnesses(root);
		assert.deepEqual([...ok], ["pi"]);
	});
});

test("Corrupt reports are treated as untested without throwing to the caller", () => {
	withRoot((root) => {
		writeFileSync(verificationFile(root), "{ not json");
		assert.equal(verifiedHarnesses(root).size, 0);
	});
});
test("Evidence states distinguish no capture, startup failure, paused success, actual miss and isolated hit", () => {
	assert.equal(verificationEvidence(null).label, "Not tested");
	assert.equal(verificationEvidence({ status: "missing" }).label, "Entry point not found");
	assert.equal(verificationEvidence({ status: "blocked" }).label, "Verification blocked");
	assert.equal(verificationEvidence({ status: "no-request", modes: [] }).label, "No request captured");
	assert.equal(verificationEvidence({ status: "error", modes: [mode(["system"], 1)] }).label, "Verification error");
	assert.equal(verificationEvidence({ status: "captured", modes: [{ ...mode(["system"], 0), mode: "off" }] }).state, "off-verified");
	assert.equal(verificationEvidence({ status: "mismatch", modes: [mode(["system"], 0)] }).state, "miss");
	assert.equal(verificationEvidence({ status: "captured", modes: [mode(["developer"], 1)] }).state, "verified");
	assert.equal(verificationEvidence({ status: "partial", modes: [mode(["system"], 1)] }).state, "partial");
	assert.equal(verificationEvidence({ status: "captured", modes: [mode(["system"], 2)] }).state, "partial");
	assert.equal(verificationEvidence({ status: "captured", modes: [{ ...mode(["system"], 1), exitCode: 1 }] }).state, "error");
	assert.equal(verificationEvidence({ status: "captured", modes: [mode(["system"], 1)] }).runtimeConfirmed, false);
	assert.equal(verificationEvidence({ status: "captured", modes: [{ ...mode(["system"], 1), requests: [
		{ kind: "main", roles: ["system"], markerCount: 1 }, { kind: "auxiliary", roles: ["system"], markerCount: 0 },
	] }] }).state, "verified", "Auxiliary requests such as title generation must not alter the main request verdict");
	assert.equal(sysHit({ modes: [{ requests: [{ kind: "auxiliary", roles: ["system"], markerCount: 1 }] }] }), false);
	assert.match(captureScopeLabel({ kind: "isolated-cli", profile: "headless" }), /Isolated CLI.*headless/);
	assert.match(captureScopeLabel(null), /entry point not recorded/);
});
test("A failed process or paused capture cannot be recorded as verified persona support", () => {
	withRoot(root => {
		writeFileSync(verificationFile(root), JSON.stringify(report([
			{ harness: "dsh", status: "error", modes: [mode(["system"], 1)] },
			{ harness: "pi", status: "captured", modes: [{ ...mode(["system"], 0), mode: "off" }] },
		])));
		assert.equal(verifiedHarnesses(root).size, 0);
	});
});
