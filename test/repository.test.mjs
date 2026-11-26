import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDocumentationLinks, publicationProblem } from '../scripts/check-repo.mjs';

test('publication policy keeps source/tests but excludes personal data and generated output', () => {
  for (const file of ['README.md','test/safety.test.mjs','lib/templates/personas/neutral.md','web/assets/agent-purge.ico','package-lock.json','.env.example'])
    assert.equal(publicationProblem(file), null, file);
  for (const file of ['out/requests.json','.pi/local.json','.opencode/package.json','node_modules/x/index.js',
    'personas/private.md','state.json','.env','.env.local','packaging/launcher.exe','web/shots/wip.png','docs/evidence/local.json','download.tgz'])
    assert.ok(publicationProblem(file), file);
  for (const file of ['test/release.test.mjs','scripts/test.mjs','magpie-plugin/hooks.js','package-lock.json'])
    assert.ok(publicationProblem(file, { distribution: true }), file);
  assert.equal(publicationProblem('magpie-plugin/README.md', { distribution: true }), null);
});
test('local documentation links must target published files and real heading anchors', () => {
  const root = mkdtempSync(join(tmpdir(), 'ap-doc-links-'));
  try {
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, 'README.md'), '[guide](docs/usage.md#\u6682\u505c\u64a4\u9500\u548c\u5378\u8f7d)\n');
    writeFileSync(join(root, 'docs/usage.md'), '# \u4f7f\u7528\u6307\u5357\n\n## \u6682\u505c、\u64a4\u9500\u548c\u5378\u8f7d\n');
    assert.deepEqual(checkDocumentationLinks(['README.md','docs/usage.md'], root), []);
    assert.equal(checkDocumentationLinks(['README.md'], root).length, 1, 'A target present on disk but not published must fail');
    writeFileSync(join(root, 'README.md'), '[bad](docs/usage.md#\u4e0d\u5b58\u5728)\n');
    assert.equal(checkDocumentationLinks(['README.md','docs/usage.md'], root).length, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('README shows a disclaimer section and keeps the full statement in sync with its document', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const legal = readFileSync(new URL('../docs/LEGAL.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const expected = legal.replace(/^# \u514d\u8d23\u4e0e\u5408\u89c4\u58f0\u660e\n+/, '').trimEnd()
    .replace(/^## /gm, '### ').replaceAll('](../LICENSE)', '](LICENSE)');
  assert.match(readme, /^## \u514d\u8d23\u4e0e\u5408\u89c4\u58f0\u660e$/m);
  const embedded = readme.match(/<!-- legal-body:start -->\n([\s\S]*?)\n<!-- legal-body:end -->/);
  assert.ok(embedded, 'README must contain the full expandable statement, not only an external link');
  assert.equal(embedded[1], expected, 'README and the standalone statement must match');
});
