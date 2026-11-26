// shell:false is the default; resolve standard npm shims directly to their Node entry points and handle other scripts separately.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";
import { resolveActivation } from "./state.mjs";
import { ownShimDirectory } from "./environment.mjs";
import { knownWrapper, MANAGED_PI_BATCH_LEGACY } from "./wrappers.mjs";

const WIN = process.platform === "win32";
const OWN_SHIM_DIR = ownShimDirectory();
const norm = (p) => WIN ? resolve(p).toLowerCase() : resolve(p);
export function which(names, path, exts = WIN ? [".exe", ".cmd", ".bat", ".ps1"] : [""]) {
 for (const name of names) for (const raw of path.split(delimiter)) {
  const dir = raw.replace(/^"|"$/g, "");
  if (!dir || norm(dir) === norm(OWN_SHIM_DIR)) continue;
  for (const ext of exts) { const p = join(dir, name + ext); if (existsSync(p)) return p; }
 }
 return null;
}
const SPAWN_EXTS = [".exe", ".ps1", ".cmd", ".bat"];
export function resolveBin(name, env = process.env) {
 if (!name) return null;
 if (name.includes("/") || name.includes("\\")) return existsSync(name) ? name : null;
 const real = env.AGENT_PURGE_REAL_BIN;
 if (real && existsSync(real)) {
  const base = real.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat|ps1)$/i, "");
  if ((WIN ? base.toLowerCase() : base) === (WIN ? name.toLowerCase() : name)) return real;
 }
 return which([name], env.PATH || env.Path || "", WIN ? SPAWN_EXTS : [""]);
}
/** Explicit arguments take precedence over per-harness settings, then global settings; inherited injection environment is not a new activation. */
export function launchConfig(state, id, { persona = null, mode = null } = {}) {
 const activation = resolveActivation(state, id, { launch: true, persona: persona || undefined, mode: mode || undefined });
 return { persona: activation.persona, mode: activation.mode };
}
// Accept complete standard templates only; do not extract a node_modules path from an arbitrary script and bypass its other logic.
const compact = (s) => s.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).map((l) => l.trim()).filter(Boolean).join("\n");
function npmTarget(file) {
 let text;
 try { text = readFileSync(file, "utf8"); } catch { return null; }
 const ext = extname(file).toLowerCase();
 let target;
 if (ext === ".ps1") {
  const hits = [...text.matchAll(/"\$basedir\/([^"\r\n]+)" \$args/g)];
  if (hits.length !== 4 || !hits.every((m) => m[1] === hits[0][1])) return null;
  target = hits[0][1];
  const template = `$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
$exe=".exe"
}
$ret=0
if (Test-Path "$basedir/node$exe") {
if ($MyInvocation.ExpectingInput) {
$input | & "$basedir/node$exe"  "$basedir/${target}" $args
} else {
& "$basedir/node$exe"  "$basedir/${target}" $args
}
$ret=$LASTEXITCODE
} else {
if ($MyInvocation.ExpectingInput) {
$input | & "node$exe"  "$basedir/${target}" $args
} else {
& "node$exe"  "$basedir/${target}" $args
}
$ret=$LASTEXITCODE
}
exit $ret`;
  if (compact(text) !== compact(template)) return null;
 } else if (ext === ".cmd") {
  const legacy = /"%dp0%\\([^"\r\n]+)" %\*/i.exec(text);
  const modern = /SET "NPM_CLI_JS=%~dp0\\([^"\r\n]+)"[\s\S]*?"%NODE_EXE%" "%NPM_CLI_JS%" %\*/i.exec(text);
  const m = legacy ?? modern; if (!m) return null;
  target = m[1];
  if (modern) {
   // Node 20+ npm.cmd resolves npm-prefix.js before executing npm-cli.js; accept only this fixed entry point.
   if (!/^node_modules[\\/]npm[\\/]bin[\\/]npm-cli\.js$/.test(target)) return null;
  } else {
   const template = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
IF EXIST "%dp0%\\node.exe" (
SET "_prog=%dp0%\\node.exe"
) ELSE (
SET "_prog=node"
SET PATHEXT=%PATHEXT:;.JS;=;%
)
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*`;
   if (compact(text) !== compact(template)) return null;
  }
 } else return null;
 if (!/^node_modules[\\/]/.test(target) || /[$%`]/.test(target)) return null;
 const script = join(dirname(file), target);
 return existsSync(script) ? script : null;
}
// Verified launcher templates: match the entire file; do not guess entry points from unknown batch files.
function nativeShim(file) {
 let source;
 try { source = readFileSync(file, "utf8"); } catch { return null; }
 const text = compact(source), dir = dirname(file);
 if (extname(file).toLowerCase() === ".ps1") {
  const m = /"\$basedir\/(node_modules\/[^"\r\n]+\.exe)"\s+\$args/.exec(source);
  if (!m) return null;
  const template = `$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {
$exe=".exe"
}
if ($MyInvocation.ExpectingInput) {
$input | & "$basedir/${m[1]}"   $args
} else {
& "$basedir/${m[1]}"   $args
}
exit $LASTEXITCODE`;
  const cmd = join(dir, m[1]);
  return text === compact(template) && existsSync(cmd) ? { cmd, args: [] } : null;
 }
 if (extname(file).toLowerCase() !== ".cmd") return null;
 if (text === compact(MANAGED_PI_BATCH_LEGACY)) {
  const entry = join(dir, "pi-launcher.js");
  return existsSync(entry) ? { cmd: "node", args: [entry], hostDirect: false } : null;
 }
 const dsh = `@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*
exit /b %errorlevel%`;
 if (text === compact(dsh)) {
  const cmd = resolve(dir, "../../../..", "DeepSeek Harness.exe");
  // Electron reads paths inside app.asar; ordinary existsSync cannot detect them.
  const entry = resolve(dir, "../../..", "app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js");
  return existsSync(cmd) ? { cmd, args: ["--expose-internals", entry], env: { ELECTRON_RUN_AS_NODE: "1" } } : null;
 }
 return null;
}
function dispatch(name, args, opts) {
 const env = opts.env ?? process.env;
 if (!args.every((a) => typeof a === "string" && !a.includes("\0"))) throw new Error("Arguments must be strings without NUL characters");
 const full = resolveBin(name, env) ?? name;
 if (!WIN) return { hostDirect: true, cmd: full, args, opts: { ...opts, shell: false } };
 const ext = extname(full).toLowerCase();
 const wrapper = [".cmd", ".ps1"].includes(ext) ? knownWrapper(full, env, e => which(["node"], e.PATH || e.Path || "", [".exe"])) ?? nativeShim(full) : null;
 if (wrapper) return { hostDirect: wrapper.hostDirect !== false, cmd: wrapper.cmd, args: [...wrapper.args, ...args], opts: { ...opts, env: { ...env, ...wrapper.env }, shell: false, windowsVerbatimArguments: false } };
 const script = [".cmd", ".ps1"].includes(ext) ? npmTarget(full) : null;
 if (script) {
  const localNode = join(dirname(full), "node.exe");
  const node = existsSync(localNode) ? localNode : which(["node"], env.PATH || env.Path || "", [".exe"]);
  if (!node) throw new Error(`Cannot find Node runtime for npm shim: ${full}`);
  return { hostDirect: true, cmd: node, args: [script, ...args], opts: { ...opts, shell: false, windowsVerbatimArguments: false } };
 }
 if (ext === ".ps1") {
  // Do not insert user arguments into PowerShell source or command lines; pass JSON through a child-specific environment.
  const payload = JSON.stringify({ file: resolve(full), args });
  if (payload.length > 30000) throw new Error("PowerShell script arguments exceed 30000 characters; use a native entry point");
  const code = `$ErrorActionPreference='Stop'; $p=ConvertFrom-Json $env:AGENT_PURGE_PS_ARGS; Remove-Item Env:AGENT_PURGE_PS_ARGS; $a=@($p.args | ForEach-Object {[string]$_}); & $p.file @a; if ($null -ne $LASTEXITCODE) {exit $LASTEXITCODE}`;
  return { cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(code,"utf16le").toString("base64")], opts: { ...opts, env: { ...env, AGENT_PURGE_PS_ARGS: payload }, shell: false } };
 }
 if (ext === ".cmd" || ext === ".bat") {
  // Unknown batch files may expand %* again; accept only arguments that do not need multilayer escaping to avoid silent corruption.
  if (args.some((a) => !/^[a-zA-Z0-9_./:\\=+,-]+$/.test(a)) || /[%!^&|<>\r\n"]/.test(full)) throw new Error(`Nonstandard batch cannot reliably pass these arguments: ${full}; point to a native exe or Node entry point`);
  const line = `"${full}" ${args.join(" ")}`;
  if (line.length > 7000) throw new Error(`Batch arguments too long: ${full}`);
  return { cmd: env.ComSpec || env.COMSPEC || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], opts: { ...opts, shell: false, windowsVerbatimArguments: true } };
 }
 return { hostDirect: ext === ".exe", cmd: full, args, opts: { ...opts, shell: false } };
}
export function prepareCommand(name, args = [], opts = {}) { return dispatch(name, args, opts); }
export function spawnPrepared(descriptor) { return spawn(descriptor.cmd, descriptor.args, descriptor.opts); }
export function spawnBin(name, args = [], opts = {}) {
 const d = dispatch(name, args, opts); return spawn(d.cmd, d.args, d.opts);
}
export function captureBin(name, args = [], opts = {}) {
 try {
  const d = dispatch(name, args, { timeout: 4000, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, ...opts });
  const r = spawnSync(d.cmd, d.args, d.opts); return r.error || r.status !== 0 ? null : (r.stdout ?? null);
 } catch { return null; }
}
