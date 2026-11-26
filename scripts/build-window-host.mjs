// Build the native WebView2 window host (packaging/window-host.cpp).
//
// WebView2 SDK is needed only at build time: headers are used for compilation and WebView2Loader.dll is distributed with the package
// (loaded at runtime from the exe directory, without an import library). Fetch the SDK from NuGet and verify its pinned SHA-256.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Pinned WebView2 SDK: update version and SHA-256 together and check window-host.cpp IIDs on upgrade. */
const SDK_VERSION = '1.0.4314.35';
const SDK_SHA256 = '90778deb1b77e36292828b4b5833c9255c27533f40e0ddd55891ae718944edc4';
const SDK_URL = `https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/${SDK_VERSION}/microsoft.web.webview2.${SDK_VERSION}.nupkg`;

/** Handwritten IIDs in window-host.cpp must match SDK headers (MinGW lacks __declspec(uuid)). */
const REQUIRED_IIDS = {
  ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler: '4e8a3389-c9d8-4bd2-b6b5-124fee6cc14d',
  ICoreWebView2CreateCoreWebView2ControllerCompletedHandler: '6c4819f3-c9b7-4260-8127-c9f5bde7f68c',
  ICoreWebView2Controller2: 'c979903e-d4ca-4228-92eb-47ee3fa96eab',
};

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr ?? result.stdout}`);
  return result;
}

/** Download and verify the SDK, extracting headers and x64 loader; cache in dist/.cache for subsequent builds. */
function ensureSdk(root, cacheRoot) {
  const cache = join(cacheRoot, `webview2-${SDK_VERSION}`);
  const header = join(cache, 'include/WebView2.h');
  const loader = join(cache, 'WebView2Loader.dll');
  if (existsSync(header) && existsSync(loader)) return { header, include: join(cache, 'include'), loader };

  mkdirSync(cache, { recursive: true });
  const nupkg = join(cache, `webview2-${SDK_VERSION}.nupkg`);
  if (!existsSync(nupkg) || sha256(nupkg) !== SDK_SHA256) {
    console.log(`Downloading WebView2 SDK ${SDK_VERSION}…`);
    const download = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing -Uri '${SDK_URL}' -OutFile '${nupkg.replaceAll("'", "''")}'`],
    { encoding: 'utf8', windowsHide: true });
    if (download.status !== 0) throw new Error(`WebView2 SDK 下载failed: ${download.error?.message ?? download.stderr}`);
  }
  const actual = sha256(nupkg);
  if (actual !== SDK_SHA256) throw new Error(`WebView2 SDK 校验failed: 期望 ${SDK_SHA256}，实际 ${actual}`);

  const unpack = join(cache, 'unpack');
  rmSync(unpack, { recursive: true, force: true });
  mkdirSync(unpack, { recursive: true });
  run('tar', ['-xf', nupkg, '-C', unpack]); // Windows bsdtar can extract zip files.
  mkdirSync(join(cache, 'include'), { recursive: true });
  for (const name of ['WebView2.h', 'WebView2EnvironmentOptions.h']) {
    copyFileSync(join(unpack, 'build/native/include', name), join(cache, 'include', name));
  }
  copyFileSync(join(unpack, 'build/native/x64/WebView2Loader.dll'), loader);
  rmSync(unpack, { recursive: true, force: true });
  return { header, include: join(cache, 'include'), loader };
}

/** Compare header MIDL_INTERFACE strings against handwritten IIDs in window-host.cpp. */
function verifyIids(header, source) {
  const text = readFileSync(header, 'utf8');
  const cpp = readFileSync(source, 'utf8');
  const written = new Set();
  for (const match of cpp.matchAll(/\{\s*(0x[0-9a-f]{1,8}),\s*(0x[0-9a-f]{1,4}),\s*(0x[0-9a-f]{1,4}),\s*\{([^}]*)\}\s*\}/gi)) {
    const hex = (value, width) => Number(value).toString(16).padStart(width, '0');
    const tail = match[4].split(',').map(part => Number(part.trim()).toString(16).padStart(2, '0')).join('');
    written.add(`${hex(match[1], 8)}-${hex(match[2], 4)}-${hex(match[3], 4)}-${tail.slice(0, 4)}-${tail.slice(4)}`);
  }
  for (const [name, expected] of Object.entries(REQUIRED_IIDS)) {
    const match = new RegExp(`MIDL_INTERFACE\\("([0-9A-Fa-f-]+)"\\)\\s*\\r?\\n\\s*${name}\\s*:`).exec(text);
    if (!match) throw new Error(`Cannot find ${name} in WebView2 SDK; check SDK version`);
    if (match[1].toLowerCase() !== expected) throw new Error(`${name} IID changed: SDK=${match[1]}, window-host.cpp=${expected}`);
    if (!written.has(expected)) throw new Error(`window-host.cpp lacks ${name} IID ${expected}; update it`);
  }
}

/**
 * The host import table must not include MinGW runtime libraries.
 * These DLLs exist only in the build toolchain; without them on the user’s machine the loader exits with 0xC0000135 (issue #20).
 * Check with objdump during build rather than waiting for reports that double-click does nothing.
 */
export function verifyStaticRuntime(exe, label = 'window host', {
  inspect = file => spawnSync('objdump', ['-p', file], { encoding: 'utf8', windowsHide: true }),
} = {}) {
  const dump = inspect(exe);
  if (dump.error || dump.status !== 0)
    throw Object.assign(new Error(`objdump: ${dump.error?.message ?? dump.stderr}`), { code: 'RUNTIME_INSPECTION' });
  const imports = [...String(dump.stdout).matchAll(/DLL Name:\s*(\S+)/g)].map(match => match[1]);
  if (!imports.length)
    throw Object.assign(new Error(`${label} import table could not be read; runtime dependencies cannot be verified: ${exe}`), { code: 'RUNTIME_INSPECTION' });
  const dynamic = imports
    .filter(name => /^(libgcc_s_.*|libstdc\+\+.*|libwinpthread.*|libssp.*|libgomp.*|libquadmath.*)\.dll$/i.test(name));
  if (!dynamic.length) return;
  // The code makes this a hard error: ordinary build failures may fall back to a browser, but an unloadable exe must not be released.
  throw Object.assign(
    new Error(`${label} still dynamically depends on MinGW runtimes (${dynamic.join(', ')}), absent on user machines and causing silent 0xC0000135 exit; keep -static`),
    { code: 'MINGW_RUNTIME' });
}
/**
 * 编译window host并放进瘦包目录。
 * @param {string} root repository root
 * @param {string} out thin package output directory (dist/agent-purge)
 * @param {string} cacheRoot build cache directory (dist/.cache)
 */
export function buildWindowHost(root, out, cacheRoot = join(root, 'dist', '.cache')) {
  const source = join(root, 'packaging/window-host.cpp');
  const resource = join(root, 'packaging/window-host.rc');
  const exe = join(out, 'agent-purge-window.exe');
  const sdk = ensureSdk(root, cacheRoot);
  verifyIids(sdk.header, source);

  // The installer ships x64 only: reject non-64-bit compilers rather than producing a host unable to load x64 WebView2Loader.dll.
  const machine = run('g++', ['-dumpmachine']).stdout.trim();
  if (!machine.startsWith('x86_64')) throw new Error(`window host requires a 64-bit compiler; current target is ${machine}`);
  const object = join(cacheRoot, 'window-host.res');
  const windres = spawnSync('windres', [resource, '-O', 'coff', '-o', object], { cwd: root, encoding: 'utf8' });
  if (windres.status !== 0) throw new Error(`windres: ${windres.error?.message ?? windres.stderr}`);

  // -static links libgcc / libstdc++ / libwinpthread statically. These DLLs are not included with Windows or the installer;
  // dynamic dependencies cause silent 0xC0000135 exit on user machines (issue #20). Size grows from ~70KB to ~270KB.
  const gcc = spawnSync('g++', ['-std=c++17', '-O2', '-mwindows', '-s', '-static', '-I', sdk.include, source, object, '-o', exe,
    '-lole32', '-luuid', '-lshell32'], { cwd: root, encoding: 'utf8' });
  if (gcc.status !== 0) throw new Error(`g++: ${gcc.error?.message ?? gcc.stderr}`);
  if (!existsSync(exe)) throw new Error('window hostwas not generated');
  verifyStaticRuntime(exe);

  const loader = join(out, 'WebView2Loader.dll');
  writeFileSync(loader, readFileSync(sdk.loader));
  console.log(`window host: ${exe} (${Math.round(statSync(exe).size / 1024)} KB) + WebView2Loader.dll (${Math.round(statSync(loader).size / 1024)} KB)`);
  return { exe, loader };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  buildWindowHost(root, join(root, 'dist', 'agent-purge'));
}
