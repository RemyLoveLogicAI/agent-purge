import test from "node:test";
import assert from "node:assert/strict";
import "./isolate.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isolatedEnv } from "../lib/environment.mjs";
import {
	parseSource,
	normalizeMirror,
	applyMirror,
	parsePersonaDoc,
	sanitizeId,
	importFromDirectory,
	pullFromGitHub,
	importPersonas,
} from "../lib/persona-import.mjs";
import { createStore } from "../lib/personas.mjs";

test("parseSource parses source strings", () => {
	// GitHub short name
	const gh1 = parseSource("ZiChuanLan/some-magic");
	assert.equal(gh1.kind, "github");
	assert.equal(gh1.owner, "ZiChuanLan");
	assert.equal(gh1.repo, "some-magic");
	assert.equal(gh1.ref, "main");

	// GitHub with branch
	const gh2 = parseSource("owner/repo@dev");
	assert.equal(gh2.ref, "dev");

	// Full GitHub URL
	const gh3 = parseSource("https://github.com/ZiChuanLan/some-magic/tree/release/prompts");
	assert.equal(gh3.kind, "github");
	assert.equal(gh3.owner, "ZiChuanLan");
	assert.equal(gh3.repo, "some-magic");
	assert.equal(gh3.ref, "release");
	assert.equal(gh3.subpath, "prompts");

	// Existing local directory
	const tempDir = mkdtempSync(join(tmpdir(), "ap-src-test-"));
	try {
		const local = parseSource(tempDir);
		assert.equal(local.kind, "local");
		assert.equal(local.path.toLowerCase(), tempDir.toLowerCase());
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
});

test("sanitizeId and parsePersonaDoc normalize metadata", () => {
	assert.equal(sanitizeId("My Persona! @#"), "my-persona");
	assert.equal(sanitizeId("active"), "persona"); // active is a reserved name

	const docWithFm = `---
id: custom-bot
name: \u673a\u68b0\u59ec
description: \u6d4b\u8bd5\u4eba\u8bbe
order: 5
harness: ["pi", "dsh"]
---
\u4f60\u662f\u9ad8\u7ea7\u4ee3\u7801\u52a9\u624b。`;
	const p1 = parsePersonaDoc(docWithFm, "fallback");
	assert.equal(p1.id, "custom-bot");
	assert.equal(p1.meta.name, "\u673a\u68b0\u59ec");
	assert.equal(p1.meta.order, 5);
	assert.deepEqual(p1.meta.harness, ["pi", "dsh"]);
	assert.equal(p1.body, "\u4f60\u662f\u9ad8\u7ea7\u4ee3\u7801\u52a9\u624b。");

	const docNoFm = `\u8fd9\u662f\u6ca1\u6709\u4efb\u4f55\u5143\u6570\u636e\u7684\u88f8\u63d0\u793a\u8bcd。`;
	const p2 = parsePersonaDoc(docNoFm, "simple-agent");
	assert.equal(p2.id, "simple-agent");
	assert.equal(p2.meta.name, "simple-agent");
	assert.equal(p2.body, "\u8fd9\u662f\u6ca1\u6709\u4efb\u4f55\u5143\u6570\u636e\u7684\u88f8\u63d0\u793a\u8bcd。");
});

test("importFromDirectory imports local files in bulk and filters them", () => {
	const srcDir = mkdtempSync(join(tmpdir(), "ap-import-src-"));
	const targetRoot = mkdtempSync(join(tmpdir(), "ap-import-target-"));

	try {
		// Write two valid personas, a README, an empty file and a hidden file.
		writeFileSync(
			join(srcDir, "xiaomajiang.md"),
			`---\nid: xiaomajiang\nname: \u5c0f\u7801\u9171\n---\n\u5c0f\u7801\u9171\u4e13\u5c5e\u63d0\u793a\u8bcd`
		);
		writeFileSync(
			join(srcDir, "ctf.md"),
			`# CTF \u6a21\u5f0f\n\u6311\u6218\u76ee\u6807\u662f\u6c99\u7bb1`
		);
		writeFileSync(join(srcDir, "README.md"), `# Readme\n\u8bf4\u660e\u6587\u6863`);
		writeFileSync(join(srcDir, ".hidden.md"), `\u9690\u85cf\u5185\u5bb9`);
		writeFileSync(join(srcDir, "empty.md"), ``);

		const res = importFromDirectory(srcDir, targetRoot, { overwrite: true });
		assert.equal(res.success, true);
		assert.equal(res.total, 2);
		assert.equal(res.imported.length, 2);

		const store = createStore(targetRoot);
		const xmj = store.read("xiaomajiang");
		assert.ok(xmj);
		assert.equal(xmj.meta.name, "\u5c0f\u7801\u9171");
		assert.equal(xmj.body.trim(), "\u5c0f\u7801\u9171\u4e13\u5c5e\u63d0\u793a\u8bcd");

		const ctf = store.read("ctf");
		assert.ok(ctf);
		assert.equal(ctf.body.trim(), "# CTF \u6a21\u5f0f\n\u6311\u6218\u76ee\u6807\u662f\u6c99\u7bb1");

		// Test overwrite: false: skip existing files and import new ones.
		writeFileSync(join(srcDir, "ctf.md"), `# CTF \u6a21\u5f0f\u6539\u7248`);
		writeFileSync(join(srcDir, "newbot.md"), `# \u65b0\u673a\u5668\u4eba`);
		const resNoOverwrite = importFromDirectory(srcDir, targetRoot, { overwrite: false });
		assert.equal(resNoOverwrite.imported.length, 1);
		assert.equal(resNoOverwrite.imported[0].id, "newbot");
		assert.equal(resNoOverwrite.skipped.some((x) => x.id === "ctf"), true);
	} finally {
		rmSync(srcDir, { recursive: true, force: true });
		rmSync(targetRoot, { recursive: true, force: true });
	}
});

test("pullFromGitHub handles mock network responses and blob fallback parsing", async () => {
	const targetRoot = mkdtempSync(join(tmpdir(), "ap-gh-test-"));
	const originalFetch = globalThis.fetch;

	try {
		// Mock fetch
		globalThis.fetch = async (url) => {
			const u = String(url);
			if (u.includes("/contents")) {
				return {
					ok: true,
					status: 200,
					json: async () => [
						{
							name: "magic.md",
							type: "file",
							download_url: "https://raw.mock/magic.md",
						},
						{
							name: "README.md",
							type: "file",
							download_url: "https://raw.mock/README.md",
						},
					],
				};
			}
			if (u.includes("magic.md")) {
				return {
					ok: true,
					status: 200,
					text: async () => `---\nid: magic\nname: \u9b54\u6cd5\n---\n\u65bd\u5c55\u9b54\u6cd5`,
				};
			}
			return { ok: false, status: 404, text: async () => "Not Found" };
		};

		const res = await pullFromGitHub(
			{ owner: "mock-user", repo: "mock-repo", ref: "main", subpath: "" },
			targetRoot
		);
		assert.equal(res.success, true);
		assert.equal(res.total, 1);
		assert.equal(res.imported[0].id, "magic");

		const store = createStore(targetRoot);
		assert.ok(store.read("magic"));
		assert.equal(store.read("magic").body.trim(), "\u65bd\u5c55\u9b54\u6cd5");

		// Test the importPersonas unified dispatch entry point.
		const unifiedRes = await importPersonas("mock-user/mock-repo", targetRoot);
		assert.equal(unifiedRes.total, 1);
	} finally {
		globalThis.fetch = originalFetch;
		rmSync(targetRoot, { recursive: true, force: true });
	}
});

test("normalize GitHub mirror URL, rewrite URLs and hide tokens while pulling", async () => {
	assert.equal(normalizeMirror(""), "");
	assert.equal(normalizeMirror("gh-proxy.com/"), "https://gh-proxy.com");
	assert.equal(normalizeMirror("http://127.0.0.1:8080/"), "http://127.0.0.1:8080");
	assert.throws(() => normalizeMirror("ftp://mirror.invalid"), /http/);

	assert.equal(
		applyMirror("https://api.github.com/repos/a/b/contents?ref=main", "gh-proxy.com/"),
		"https://gh-proxy.com/https://api.github.com/repos/a/b/contents?ref=main"
	);
	assert.equal(
		applyMirror("https://raw.githubusercontent.com/a/b/main/x.md", "https://proxy.example/{url}"),
		"https://proxy.example/https://raw.githubusercontent.com/a/b/main/x.md"
	);

	const fromMirroredUrl = parseSource("https://gh-proxy.com/https://github.com/ZiChuanLan/some-magic/tree/dev/prompts");
	assert.equal(fromMirroredUrl.kind, "github");
	assert.equal(fromMirroredUrl.owner, "ZiChuanLan");
	assert.equal(fromMirroredUrl.repo, "some-magic");
	assert.equal(fromMirroredUrl.ref, "dev");
	assert.equal(fromMirroredUrl.subpath, "prompts");
	assert.equal(fromMirroredUrl.mirror, "https://gh-proxy.com");

	const targetRoot = mkdtempSync(join(tmpdir(), "ap-gh-mirror-"));
	const originalFetch = globalThis.fetch;
	const seen = [];
	try {
		globalThis.fetch = async (url, init = {}) => {
			const u = String(url);
			seen.push({ url: u, auth: init.headers?.Authorization ?? null });
			if (u === "https://gh-proxy.com/https://api.github.com/repos/mock-user/mock-repo/contents?ref=main") {
				return {
					ok: true,
					status: 200,
					json: async () => [
						{
							name: "raw-ok.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/mock-user/mock-repo/main/raw-ok.md",
							git_url: "https://api.github.com/repos/mock-user/mock-repo/git/blobs/111",
						},
						{
							name: "blob-fallback.md",
							type: "file",
							download_url: "https://raw.githubusercontent.com/mock-user/mock-repo/main/blob-fallback.md",
							git_url: "https://api.github.com/repos/mock-user/mock-repo/git/blobs/222",
						},
					],
				};
			}
			if (u === "https://gh-proxy.com/https://raw.githubusercontent.com/mock-user/mock-repo/main/raw-ok.md") {
				return { ok: true, status: 200, text: async () => "---\nid: raw-ok\nname: RawOK\n---\nRAW_BODY" };
			}
			if (u === "https://gh-proxy.com/https://api.github.com/repos/mock-user/mock-repo/git/blobs/222") {
				return {
					ok: true,
					status: 200,
					json: async () => ({ encoding: "base64", content: Buffer.from("---\nid: blob-ok\nname: BlobOK\n---\nBLOB_BODY").toString("base64") }),
				};
			}
			return { ok: false, status: 404, text: async () => "Not Found" };
		};

		const res = await importPersonas("mock-user/mock-repo", targetRoot, {
			mirror: "gh-proxy.com/",
			token: "secret-token-must-not-leak",
		});
		assert.equal(res.success, true);
		assert.equal(res.total, 2);
		assert.equal(res.source.mirror, "https://gh-proxy.com");
		assert.equal(seen.every((s) => s.url.startsWith("https://gh-proxy.com/")), true);
		assert.equal(seen.every((s) => s.auth === null), true, "GitHub token must not leak when using a mirror");
		const store = createStore(targetRoot);
		assert.equal(store.read("raw-ok").body.trim(), "RAW_BODY");
		assert.equal(store.read("blob-ok").body.trim(), "BLOB_BODY");
	} finally {
		globalThis.fetch = originalFetch;
		rmSync(targetRoot, { recursive: true, force: true });
	}
});

test("CLI pull --mirror parsing and validation", () => {
	const root = mkdtempSync(join(tmpdir(), "ap-cli-mirror-"));
	const cli = fileURLToPath(new URL("../bin/agent-purge.mjs", import.meta.url));
	try {
		const env = isolatedEnv(root);
		const missingVal = spawnSync(
			process.execPath,
			[cli, "pull", "--mirror"],
			{ env, encoding: "utf8" }
		);
		assert.notEqual(missingVal.status, 0);
		assert.match(missingVal.stderr, /--mirror/);

		const badScheme = spawnSync(
			process.execPath,
			[cli, "pull", "--mirror=ftp://bad.mirror", "ZiChuanLan/some-magic"],
			{ env, encoding: "utf8" }
		);
		assert.notEqual(badScheme.status, 0);
		assert.match(badScheme.stderr, /http/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
