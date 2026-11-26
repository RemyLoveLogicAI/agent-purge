// Explicit Node 20+ thin package; copy only allowlisted runtime files, excluding screenshots, test output, and private personas.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, readJSON, runtimeFiles, writeManifest } from './build-common.mjs';
import { buildWindowHost, verifyStaticRuntime } from './build-window-host.mjs';
import { smoke } from './build-smoke.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist'), OUT = join(DIST, 'agent-purge');
const VERSION = readJSON(join(ROOT,'package.json')).version;
rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
for (const file of runtimeFiles(ROOT)) {
  const target = join(OUT, file); mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(ROOT,file),target);
}
writeFileSync(join(OUT,'agent-purge.cmd'), [
  '@echo off',
  'node -e "process.exit(Number(process.versions.node.split(\'.\')[0]) >= 20 ? 0 : 1)" >nul 2>nul',
  'if errorlevel 1 (echo agent-purge needs Node.js 20+ : https://nodejs.org & exit /b 1)',
  'node "%~dp0bin\\agent-purge.mjs" %*',
].join('\r\n')+'\r\n');

if (process.platform === 'win32') {
  const resource = join(OUT,'launcher.rc'), object = join(OUT,'launcher.res');
  try {
    writeFileSync(resource, `1 ICON "${join(ROOT,'web/assets/agent-purge.ico').replaceAll('\\','/')}"\r\n`);
    const windres = spawnSync('windres',[resource,'-O','coff','-o',object],{cwd:ROOT,encoding:'utf8'});
    if (windres.status !== 0) throw new Error(`windres: ${windres.error?.message ?? windres.stderr}`);
    // Likewise -static (issue #20): the launcher imports only system DLLs now, but toolchain or code changes can make gcc add libgcc/libssp,
    // which user machines lack, causing a silent 0xC0000135 exit when double-clicked.
    const gcc = spawnSync('gcc',['-O2','-s','-mwindows','-static',join(ROOT,'packaging/launcher.c'),object,'-o',join(OUT,'agent-purge.exe')],{cwd:ROOT,encoding:'utf8'});
    if (gcc.status !== 0) throw new Error(`gcc: ${gcc.error?.message ?? gcc.stderr}`);
  } finally { rmSync(resource,{force:true});rmSync(object,{force:true}); }
  if (!existsSync(join(OUT,'agent-purge.exe'))) throw new Error('Desktop launcher was not generated; do not use an old precompiled file');
  verifyStaticRuntime(join(OUT,'agent-purge.exe'), 'Desktop launcher');
  // Native window host: WebView2 gives the console its own window without browser accounts or first-run setup. Failure does not block the thin package;
  // at runtime openAppWindow falls back to Chrome/Edge --app mode.
  try { buildWindowHost(ROOT, OUT); }
  catch (error) {
    // A host build failure may fall back to a browser window, but shipping an exe that cannot load is not acceptable: that was issue #20.
    if (error.code === 'MINGW_RUNTIME' || error.code === 'RUNTIME_INSPECTION') throw error;
    // A failed compiler may leave an incomplete exe. Once falling back, runtime must not select that file.
    rmSync(join(OUT, 'agent-purge-window.exe'), { force: true });
    rmSync(join(OUT, 'WebView2Loader.dll'), { force: true });
    console.warn(`Window host was not generated; desktop will fall back to browser --app mode: ${error.message}`);
  }
}
writeManifest(OUT,'thin',VERSION,ROOT);
await smoke(process.execPath,[join(OUT,'bin/agent-purge.mjs')],{cwd:OUT,version:VERSION});
console.log(`Thin package: ${OUT} (${Math.round(listFiles(OUT).reduce((size,file)=>size+statSync(join(OUT,file)).size,0)/1024)} KB)`);
if (process.platform === 'win32') {
  const zip = join(DIST,`agent-purge-${VERSION}.zip`);
  rmSync(zip,{force:true});
  // When PowerShell 7 launches Node and then Windows PowerShell 5, an incompatible
  // PSModulePath is inherited; use the system .NET ZIP API rather than relying on Archive module autoloading.
  const result = spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${OUT.replaceAll("'","''")}','${zip.replaceAll("'","''")}',[IO.Compression.CompressionLevel]::Optimal,$true)`],
    {encoding:'utf8',windowsHide:true});
  if (result.status !== 0) throw new Error(`zip: ${result.error?.message ?? result.stderr}`);
  console.log(`Portable ZIP: ${zip} (${Math.round(readFileSync(zip).length/1024)} KB)`);
}
