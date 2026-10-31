import {mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, relative} from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const roots = ['module.json', 'LICENSE', 'README.md', 'scripts', 'styles', 'templates', 'docs'];
function files(directory) {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
function tar(args) {
  const result = spawnSync('tar.exe', args, {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'tar.exe failed');
  return result.stdout;
}
const temporary = mkdtempSync(join(tmpdir(), 'combat-pulse-package-'));
try {
  const stage = join(temporary, 'combat-pulse');
  const verify = join(temporary, 'verify');
  mkdirSync(stage);
  mkdirSync(verify);
  const sourceFiles = roots.flatMap(path => statSync(path).isDirectory() ? files(path) : [path]);
  for (const path of sourceFiles) {
    const destination = join(stage, path);
    mkdirSync(resolve(destination, '..'), {recursive: true});
    copyFileSync(path, destination);
  }
  mkdirSync('dist', {recursive: true});
  const archive = resolve('dist/combat-pulse.zip');
  tar(['-a', '-c', '-f', archive, '-C', temporary, 'combat-pulse']);
  const archiveFiles = tar(['-t', '-f', archive]).trim().split(/\r?\n/).filter(path => !path.endsWith('/')).sort();
  assert.deepEqual(archiveFiles, sourceFiles.map(path => `combat-pulse/${path.replaceAll('\\', '/')}`).sort());
  tar(['-x', '-f', archive, '-C', verify]);
  for (const path of files(join(verify, 'combat-pulse'))) {
    const source = relative(join(verify, 'combat-pulse'), path);
    assert.deepEqual(readFileSync(path), readFileSync(source), `Archive bytes differ for ${source}`);
  }
  console.log(`Verified ${sourceFiles.length} packaged files byte-for-byte in dist/combat-pulse.zip.`);
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
