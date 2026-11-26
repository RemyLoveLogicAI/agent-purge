import './isolate.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimInstance, instancePath, processAlive, readInstance, registerInstance, releaseInstance, updateWindow } from '../lib/web-instance.mjs';

const sandbox = mkdtempSync(join(tmpdir(), 'ap-instance-'));
test.after(() => rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));

const DEAD_PID = 999999;

test('claimInstance: a second process cannot claim the same home or overwrite the registered pid', async () => {
  const home = mkdtempSync(join(sandbox, 'home-'));
  assert.deepEqual(claimInstance(home, { pid: DEAD_PID + 1, port: 7788 }), { ok: true });
  assert.equal(readInstance(home).port, 7788);

  // Find a genuinely live pid other than our own: the placeholder file must block another process.
  const { spawn } = await import('node:child_process');
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    writeFileSync(instancePath(home), JSON.stringify({ pid: holder.pid, port: 7788 }));
    const second = claimInstance(home, { pid: process.pid, port: 7890 });
    assert.equal(second.ok, false);
    assert.equal(second.existing?.port, 7788, 'On conflict return the existing instance so the caller can reuse its window');
    assert.equal(readInstance(home).pid, holder.pid);
  } finally {
    holder.kill();
  }
});

test('claimInstance: stale registration from a killed process is removed and recreated', () => {
  const home = mkdtempSync(join(sandbox, 'stale-'));
  writeFileSync(instancePath(home), JSON.stringify({ pid: DEAD_PID, port: 7788 }));
  assert.equal(processAlive(DEAD_PID), false);
  assert.deepEqual(claimInstance(home, { pid: process.pid, port: 7890 }), { ok: true });
  assert.equal(readInstance(home).port, 7890);
  releaseInstance(home, process.pid);
});

test('readInstance: a malformed file is treated as no registration', () => {
  const home = mkdtempSync(join(sandbox, 'broken-'));
  writeFileSync(instancePath(home), '{"pid":');
  assert.equal(readInstance(home), null);
  writeFileSync(instancePath(home), JSON.stringify({ pid: 'x', port: 7788 }));
  assert.equal(readInstance(home), null);
});

test('updateWindow: updates only its own registration and checks pid on exit cleanup', () => {
  const home = mkdtempSync(join(sandbox, 'window-'));
  assert.deepEqual(claimInstance(home, { pid: process.pid, port: 7788 }), { ok: true });
  assert.equal(updateWindow(home, process.pid, 4242), true);
  assert.equal(readInstance(home).windowPid, 4242);
  assert.equal(updateWindow(home, DEAD_PID, 999), false, 'Do not modify another process registration');

  assert.equal(releaseInstance(home, DEAD_PID), false);
  assert.equal(readInstance(home)?.windowPid, 4242);
  assert.equal(releaseInstance(home, process.pid), true);
  assert.equal(readInstance(home), null);
});

test('registerInstance: port 0 (random port for isolated smoke tests) bypasses the singleton', () => {
  const home = mkdtempSync(join(sandbox, 'ephemeral-'));
  assert.deepEqual(registerInstance(home, 0), { ok: true });
  assert.equal(readInstance(home), null);
});

test('registerInstance: exit events clean up the file after registration', async () => {
  const home = mkdtempSync(join(sandbox, 'exit-'));
  const script = [
    `import { registerInstance, readInstance } from ${JSON.stringify(new URL('../lib/web-instance.mjs', import.meta.url).href)};`,
    `const home = ${JSON.stringify(home)};`,
    "registerInstance(home, 7788);",
    "console.log(JSON.stringify(readInstance(home)));",
  ].join('\n');
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout.trim()).port, 7788);
  assert.equal(readInstance(home), null, 'Registration must disappear after the child process exits');
});
