// Release 检查与受限流式下载；只有确证的编译产品可以自替换，共享 node.exe 始终保持原样。
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, readSync, writeSync, constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readResource, isCompiled, ROOT } from "./root.mjs";
import { atomicControlJSON } from "./control.mjs";

export const GITHUB_REPO = "ZiChuanLan/agent-purge";
export const RELEASES_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`;
export const NPM_REGISTRY = "https://registry.npmjs.org/agent-purge/latest";
export const NPM_MIRROR = "https://registry.npmmirror.com/agent-purge/latest";

export function currentVersion() {
	try { return JSON.parse(readResource("package.json").toString("utf8")).version || "0.0.0"; }
	catch { return "0.0.0"; }
}
// 当前 Release 仅有 Windows EXE，不能用它覆盖 Linux/macOS 的编译产物。
export const canReplaceSelf = () => process.platform === 'win32' && isCompiled() && !/^(?:node|bun)(?:\.exe)?$/i.test(basename(process.execPath));

/** 源码检出（git clone 后直接 node bin/...）跑的是安装目录里的实时文件，更新等于 git pull */
export function isGitCheckout(root = ROOT) {
	if (isCompiled()) return false;
	try { return statSync(join(root, ".git")).isDirectory(); } catch { return false; }
}

export function detectInstallType() {
	if (canReplaceSelf()) return "exe";
	if (isGitCheckout()) return "git";
	return "npm";
}

/** 在安装目录里跑一条 git 命令，永不进 shell；超时/非零退出都折算成可读结果 */
function git(args, { root = ROOT, timeout = 20000 } = {}) {
	const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", timeout, windowsHide: true });
	if (r.error) throw new Error(`git ${args[0]} failed: ${r.error.message}`);
	const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
	return { ok: r.status === 0, code: r.status, out };
}

/** 只读：分支、上游、是否有未提交改动 */
export function gitCheckoutState({ root = ROOT } = {}) {
	if (!isGitCheckout(root)) return { ok: false, reason: "Not a git checkout" };
	const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], { root });
	if (!branch.ok) return { ok: false, reason: branch.out || "Could not read the current branch" };
	const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { root });
	const dirty = git(["status", "--porcelain"], { root });
	return {
		ok: true,
		branch: branch.out,
		upstream: upstream.ok ? upstream.out : null,
		dirty: dirty.ok ? dirty.out.split(String.fromCharCode(10)).filter((line) => line.trim()).length : null,
	};
}

/**
 * 落后/领先上游多少提交。源码检出没有版本号变更也可能有新提交，
 * 所以「有没有更新」不能只看 Release 版本；force 时才 fetch，避免每次开页面都联网。
 */
export function gitTrackState({ root = ROOT, fetch = false, timeout = 30000 } = {}) {
	if (!isGitCheckout(root)) return { ok: false, reason: "Not a git checkout" };
	const state = gitCheckoutState({ root });
	if (!state.ok) return { ok: false, reason: state.reason };
	if (!state.upstream) return { ok: false, reason: "No upstream" };
	let fetched = null;
	if (fetch) {
		const r = git(["fetch", "--quiet"], { root, timeout });
		if (!r.ok) return { ok: false, branch: state.branch, upstream: state.upstream, dirty: state.dirty, reason: r.out || "git fetch failed" };
		fetched = true;
	}
	const behind = git(["rev-list", "--count", `HEAD..${state.upstream}`], { root });
	const ahead = git(["rev-list", "--count", `${state.upstream}..HEAD`], { root });
	const n = (r) => (r.ok && /^\d+$/.test(r.out) ? Number(r.out) : null);
	return {
		ok: true,
		branch: state.branch,
		upstream: state.upstream,
		dirty: state.dirty,
		behind: n(behind),
		ahead: n(ahead),
		fetched: Boolean(fetched),
	};
}

/**
 * 就地更新源码检出：git pull --ff-only。
 * 为什么必须 --ff-only：本地可能有未推送的提交，普通 pull 会造出一个没人预期的合并提交，
 * 而这条路径是从 Web 面板点出来的，用户看不到合并编辑器。
 */
export function gitPullSelf({ root = ROOT, timeout = 120000 } = {}) {
	if (!isGitCheckout(root)) throw new Error("This is not a git source checkout");
	const state = gitCheckoutState({ root });
	if (!state.ok) throw new Error(state.reason);
	if (!state.upstream) throw new Error(`Branch ${state.branch} has no upstream; cannot determine where to pull from`);
	if (state.dirty) throw new Error(`Working tree has ${state.dirty} uncommitted changes; commit or revert them before updating`);
	const before = git(["rev-parse", "HEAD"], { root });
	const pull = git(["pull", "--ff-only"], { root, timeout });
	// 拉取失败必须抛，不能把 stderr 塞进 output 当成功返回：面板会显示「已是最新」
	if (!pull.ok) throw new Error(`git pull failed: ${pull.out || `exit code ${pull.code}`}`);
	const after = git(["rev-parse", "HEAD"], { root });
	return {
		ok: true,
		branch: state.branch,
		upstream: state.upstream,
		before: before.out.slice(0, 7),
		after: after.out.slice(0, 7),
		changed: Boolean(before.ok && after.ok && before.out !== after.out),
		output: pull.out,
	};
}

/** 极速并发探测 npm 官方源与国内镜像源的最新版本 */
export async function checkNpmVersion({ timeout = 4000 } = {}) {
	const current = currentVersion();
	const fetchEndpoint = async (url) => {
		const ctrl = new AbortController();
		const t = setTimeout(() => ctrl.abort(), timeout);
		try {
			const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await abortable(res.json(), ctrl.signal);
			const version = String(data.version || "").replace(/^v/, "");
			if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) throw new Error("Invalid version format");
			return { version, time: data.time?.[version] || null, description: data.description || "" };
		} finally { clearTimeout(t); }
	};
	try {
		const result = await Promise.any([fetchEndpoint(NPM_REGISTRY), fetchEndpoint(NPM_MIRROR)]);
		return { ok: true, source: "npm", current, latest: result.version, hasUpdate: compareSemver(current, result.version) > 0, publishedAt: result.time, description: result.description, at: Date.now() };
	} catch (error) {
		return { ok: false, source: "npm", current, latest: current, hasUpdate: false, error: error.message };
	}
}

export function compareSemver(a, b) {
	const parse = value => String(value).replace(/^v/, "").split("+")[0].split(/-(.*)/s);
	const [am, ap] = parse(a), [bm, bp] = parse(b);
	const aa = am.split(".").map(Number), bb = bm.split(".").map(Number);
	for (let i = 0; i < 3; i++) { const delta = (bb[i] || 0) - (aa[i] || 0); if (delta) return delta; }
	if (ap === bp) return 0;
	if (ap === undefined) return -1;
	if (bp === undefined) return 1;
	const ax = ap.split("."), bx = bp.split(".");
	for (let i = 0; i < Math.max(ax.length, bx.length); i++) {
		if (ax[i] === bx[i]) continue;
		if (ax[i] === undefined) return 1;
		if (bx[i] === undefined) return -1;
		const an = /^\d+$/.test(ax[i]), bn = /^\d+$/.test(bx[i]);
		if (an && bn) return Number(bx[i]) - Number(ax[i]);
		if (an !== bn) return an ? 1 : -1;
		return bx[i] > ax[i] ? 1 : -1;
	}
	return 0;
}
export async function checkForUpdate({ timeout = 5000, cacheFile, force = false } = {}) {
	const current = currentVersion();
	if (!force && cacheFile) {
		try {
			const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
			if (cached.ok === true && typeof cached.latest === "string" && Date.now() - cached.at >= 0 && Date.now() - cached.at < 86400000)
				return { ...cached, current, hasUpdate: compareSemver(current, cached.latest) > 0, fromCache: true };
		} catch {}
	}
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
	try {
		const response = await fetch(RELEASES_API, { signal: controller.signal, headers: { Accept: "application/vnd.github.v3+json", "User-Agent": `agent-purge/${current}` } });
		if (response.status === 404) return { current, ok: true, published: false, latest: current, hasUpdate: false, body: "No public release yet.", htmlUrl: RELEASES_PAGE, assets: [], at: Date.now() };
		if (!response.ok) throw new Error(`GitHub API returned ${response.status}: ${response.statusText}`);
		const data = await abortable(response.json(), controller.signal);
		const latest = String(data.tag_name ?? "").replace(/^v/, "");
		if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(latest)) throw new Error("Invalid release version field");
		const assets = (Array.isArray(data.assets) ? data.assets : []).filter(a => typeof a.name === "string" && /^https:\/\//.test(a.browser_download_url ?? ""))
			.map(a => ({ name: a.name, size: a.size, downloadUrl: a.browser_download_url, digest: a.digest ?? null }));
		const result = { ok: true, current, latest, hasUpdate: compareSemver(current, latest) > 0, tagName: data.tag_name,
			name: data.name || data.tag_name, body: String(data.body ?? ""), publishedAt: data.published_at, htmlUrl: data.html_url || RELEASES_PAGE, assets, at: Date.now() };
		if (cacheFile) { try { mkdirSync(dirname(cacheFile), { recursive: true }); atomicControlJSON(cacheFile, result); } catch {} }
		return result;
	} catch (error) { return { ok: false, current, latest: current, hasUpdate: false, error: controller.signal.aborted ? "Request timed out" : error.message }; }
	finally { clearTimeout(timer); }
}
function abortable(promise, signal) {
	return new Promise((resolve, reject) => {
		const abort = () => reject(new DOMException("Request timed out", "AbortError"));
		if (signal.aborted) { abort(); return; }
		signal.addEventListener("abort", abort, { once: true });
		Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
	});
}

/** 下载到同目录临时文件，长度/摘要通过后才发布；中断时保留原 destPath。 */
export async function downloadFile(url, destPath, onProgress, { timeout = 60000, maxBytes = 512 * 1024 * 1024, expectedSize, digest } = {}) {
	if (!/^https?:\/\//i.test(url)) throw new Error("Download URL must use HTTP(S)");
	if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || (expectedSize !== undefined && (!Number.isSafeInteger(expectedSize) || expectedSize < 1))) throw new Error("Invalid download size parameter");
	const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
	const temporary = `${destPath}.part-${randomUUID()}`;
	let fd, reader;
	try {
		const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": `agent-purge/${currentVersion()}` } });
		if (!response.ok || !response.body) throw new Error(`Download failed HTTP ${response.status}`);
		const total = Number(response.headers.get("content-length") || 0);
		if (!Number.isSafeInteger(total) || total < 0 || total > maxBytes || (expectedSize !== undefined && expectedSize > maxBytes)) throw new Error("Download size exceeds the limit");
		mkdirSync(dirname(destPath), { recursive: true });
		fd = openSync(temporary, "wx", 0o600);
		reader = response.body.getReader();
		let received = 0;
		const hash = createHash("sha256");
		while (true) {
			const { done, value } = await abortable(reader.read(), controller.signal);
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) throw new Error("Download size exceeds the limit");
			hash.update(value);
			let offset = 0;
			while (offset < value.byteLength) offset += writeSync(fd, value, offset, value.byteLength - offset);
			onProgress?.(received, total);
		}
		if (!received || (total && received !== total) || (expectedSize !== undefined && received !== expectedSize)) throw new Error("Incomplete download: size mismatch");
		const sha256 = hash.digest("hex");
		if (digest && digest !== `sha256:${sha256}`) throw new Error("Download digest mismatch");
		fsyncSync(fd); closeSync(fd); fd = undefined;
		renameSync(temporary, destPath);
		return { path: destPath, size: received, sha256 };
	} finally {
		clearTimeout(timer);
		if (fd !== undefined) closeSync(fd);
		controller.abort();
		if (reader) reader.cancel().catch(() => {});
		rmSync(temporary, { force: true });
	}
}

/** 独立文件事务供夹具测试；先 copy 到目标同卷，旧二进制保留为可回滚副本。 */
export function replaceExecutable(currentExe, downloadedNewExePath) {
	if (/^(?:node|bun)(?:\.exe)?$/i.test(basename(currentExe))) throw new Error("Shared runtime remains untouched; update using a package manager");
	const fd = openSync(downloadedNewExePath, "r"), header = Buffer.alloc(2);
	try {
		if (statSync(downloadedNewExePath).size < 64 || readSync(fd, header, 0, 2, 0) !== 2 || header.toString() !== "MZ") throw new Error("Update file is not a Windows executable");
	} finally { closeSync(fd); }
	const staged = `${currentExe}.new-${randomUUID()}`, oldExePath = `${currentExe}.old-${randomUUID()}`;
	copyFileSync(downloadedNewExePath, staged, constants.COPYFILE_EXCL);
	let moved = false;
	try {
		renameSync(currentExe, oldExePath); moved = true;
		renameSync(staged, currentExe);
		return { ok: true, currentExe, oldExePath };
	} catch (error) {
		if (moved) { try { renameSync(oldExePath, currentExe); } catch (rollback) { throw new Error(`Update failed: ${error.message}; rollback failed: ${rollback.message}; old version preserved at ${oldExePath}`, { cause: error }); } }
		throw error;
	} finally { rmSync(staged, { force: true }); }
}
export function replaceSelfExecutable(downloadedNewExePath) {
	if (!canReplaceSelf()) throw new Error(`This is a Node/script installation; use npm or the installer to update: ${process.execPath}`);
	return replaceExecutable(process.execPath, downloadedNewExePath);
}
