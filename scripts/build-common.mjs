import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

export const hashFile = file => createHash('sha256').update(readFileSync(file)).digest('hex');
export function listFiles(root, dir = root) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release tree contains a symbolic link: ${path}`);
    return entry.isDirectory() ? listFiles(root, path) : [relative(root, path).replaceAll('\\', '/')];
  }).sort();
}
export function runtimeFiles(root) {
  return ['bin','lib','backends','bench'].flatMap(dir => listFiles(join(root,dir)).map(file => `${dir}/${file}`))
    .concat(['web/server.mjs','web/ui.html','web/app.js','web/model.mjs','web/i18n.mjs','web/styles.css',...listFiles(join(root,'web','assets')).map(file=>`web/assets/${file}`),'matrix.json','package.json','README.md','CONTRIBUTING.md','LICENSE'])
    .concat(existsSync(join(root,'magpie-plugin','README.md')) ? ['magpie-plugin/README.md'] : [])
    .concat(['docs/usage.md','docs/compatibility.md','docs/architecture.md','docs/releasing.md','docs/LEGAL.md',
      'docs/images/console-desktop.png','docs/images/console-mobile.png'].filter(file => existsSync(join(root,file)))).sort();
}
export function writeManifest(root, flavor, version, sources = root) {
  const files = Object.fromEntries(listFiles(root).filter(file=>file !== 'build-manifest.json').map(file=>[file,hashFile(join(root,file))]));
  const sourceFiles = Object.fromEntries(runtimeFiles(sources).map(file=>[file,hashFile(join(sources,file))]));
  const manifest = { schema: 1, flavor, version, files, sources: sourceFiles };
  writeFileSync(join(root,'build-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}
export function readJSON(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Could not read build JSON: ${file}: ${error.message}`, { cause: error }); }
}
export function validateThin(root, source) {
  const manifest = readJSON(join(root,'build-manifest.json'));
  const version = readJSON(join(source,'package.json')).version;
  if (manifest.schema !== 1 || manifest.flavor !== 'thin' || manifest.version !== version) throw new Error('Thin-package manifest or version mismatch; rerun build:js');
  const files = listFiles(root).filter(file=>file !== 'build-manifest.json');
  if (JSON.stringify(files) !== JSON.stringify(Object.keys(manifest.files).sort())) throw new Error('Thin-package file list changed; rerun build:js');
  for (const file of files) if (hashFile(join(root,file)) !== manifest.files[file]) throw new Error(`Thin-package file changed: ${file}`);
  const current = Object.fromEntries(runtimeFiles(source).map(file=>[file,hashFile(join(source,file))]));
  if (JSON.stringify(current) !== JSON.stringify(manifest.sources)) throw new Error('Workspace and thin-package sources differ; rerun build:js, then build:setup');
  return manifest;
}
