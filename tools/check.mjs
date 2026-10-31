import {readdirSync, readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

for (const directory of ['scripts', 'tools', 'tests']) {
  for (const file of readdirSync(directory).filter(value => /\.(m?js)$/.test(value))) {
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], {stdio: 'inherit'});
    assert.equal(result.status, 0, `Syntax check failed for ${directory}/${file}`);
  }
}
const manifest = JSON.parse(readFileSync('module.json', 'utf8'));
assert.equal(manifest.id, 'combat-pulse');
assert.equal(manifest.compatibility.minimum, '14');
assert.equal(manifest.relationships?.systems, undefined, 'Manifest must not restrict systems');
for (const path of [...manifest.esmodules, ...manifest.styles, manifest.license]) readFileSync(path);
console.log('Runtime, tooling, and test syntax plus manifest references passed.');
