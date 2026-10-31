import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {install} from '../scripts/main.js';
import {runtime} from './fake-runtime.mjs';
import {makeQaMacro, validateFixture} from '../tools/live-qa.mjs';
import {compareRuns, makeBenchmarkMacro, quantile} from '../tools/benchmark.mjs';

globalThis.foundry = {applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: value => value}}};

const example = JSON.parse(readFileSync(new URL('./fixtures/qa-example.json', import.meta.url), 'utf8'));
const fixture = () => ({...structuredClone(example), synthetic: false, worldId: 'w', sceneId: 's', actorId: 'a', tokenId: 't',
  install: {sha: 'a'.repeat(40), dirty: false, packageHash: 'b'.repeat(64), receipt: 'install-1'},
  machine: {label: 'test-machine', cpu: 'synthetic-cpu', ram: '16GB', gpu: 'synthetic-gpu', os: 'test-os', browserVersion: 'test-1'}});

function browser(system = 'pf2e') {
  const fake = runtime(system);
  fake.game.world = {id: 'w'};
  fake.game.version = '14.369';
  fake.game.system.version = {pf2e: '8.6.1', sf2e: '1.6.1', dnd5e: '6.0.6'}[system];
  fake.game.paused = true;
  fake.game.togglePause = async value => { fake.game.paused = value; };
  fake.game.modules.get('combat-pulse').active = true;
  Object.assign(fake.game.modules.get('combat-pulse'), {id: 'combat-pulse', version: '0.1.0'});
  Object.assign(fake.canvas.scene, {width: 2000, height: 1500, grid: {size: 100}});
  fake.canvas.app.renderer.type = 1;
  fake.PIXI.VERSION = '7.4.3';
  fake.actor.system.attributes.hp.max = 40;
  fake.actor.update = async changes => {
    fake.actor.system.attributes.hp.value = changes['system.attributes.hp.value'];
    fake.actor.system.attributes.hp.temp = changes['system.attributes.hp.temp'];
  };
  fake.game.settings.set = async (_module, key, value) => { fake.values[key] = value; fake.game.modules.get('combat-pulse').api?.clear(); };
  const listeners = new Map();
  const observers = new Set();
  fake.canvas.app.renderer.runners = {postrender: {add: value => observers.add(value), remove: value => observers.delete(value)}};
  let clock = 0, rafId = 0;
  const rafs = new Map();
  const sandbox = {
    game: fake.game, canvas: fake.canvas, PIXI: fake.PIXI,
    document: {visibilityState: 'visible', addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type)},
    navigator: {userAgent: 'synthetic-browser'},
    window: {addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type)},
    innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1, matchMedia: () => ({matches: false}),
    performance: {now: () => clock},
    requestAnimationFrame: fn => {
      const id = ++rafId;
      rafs.set(id, fn);
      setImmediate(() => {
        if (!rafs.has(id)) return;
        clock += 16;
        fake.advance(16);
        const callbacks = [...rafs.values()]; rafs.clear();
        for (const callback of callbacks) callback(clock);
        for (const observer of observers) observer.postrender();
      });
      return id;
    }, cancelAnimationFrame: id => rafs.delete(id),
    setTimeout: (fn, ms) => {
      clock += ms;
      fake.advance(ms);
      const callbacks = [...rafs.values()]; rafs.clear();
      for (const callback of callbacks) callback(clock);
      for (const observer of observers) observer.postrender();
      fn();
    }
  };
  const pulse = install({...fake, canvas: () => fake.canvas, now: fake.now});
  fake.Hooks.call('ready');
  fake.actor.applyDamage = async options => {
    const damage = typeof options === 'number' ? options : options.damage;
    const hp = fake.actor.system.attributes.hp;
    const old = {value: hp.value, temp: hp.temp};
    if (damage > 0) { const absorbed = Math.min(hp.temp, damage); hp.temp -= absorbed; hp.value = Math.max(0, hp.value - damage + absorbed); }
    else hp.value = Math.min(hp.max, hp.value - damage);
    if (system === 'dnd5e') fake.Hooks.call('updateActor', fake.actor, {}, {dnd5e: {hp: old}});
    else fake.Hooks.call('createChatMessage', fake.message(`m${clock}-${old.value}-${old.temp}`, {[system]: {appliedDamage: {
      uuid: fake.actor.uuid, updates: [{path: 'system.attributes.hp.value', value: old.value - hp.value}, {path: 'system.attributes.hp.temp', value: old.temp - hp.temp}]
    }}}));
  };
  fake.game.pf2e.CheckModifier = class {};
  fake.game.pf2e.Check = {roll: async () => {
    const message = fake.message('check', {[system]: {context: {type: 'attack-roll', outcome: 'success'}}});
    fake.Hooks.call('createChatMessage', message);
    return message.rolls[0];
  }};
  fake.actor.rollAbilityCheck = async () => {
    const message = fake.message('check', {dnd5e: {roll: {type: 'check'}}});
    fake.Hooks.call('createChatMessage', message);
    return message.rolls;
  };
  return {fake, pulse, sandbox, listeners, observers, rafs, block: ms => { clock += ms; }};
}

test('fixture and variant validation reject unsafe emission before any browser mutation', () => {
  assert.throws(() => makeQaMacro(example), /invalid-fixture/);
  for (const change of [{disposable: false}, {system: {id: 'pf2e', version: '9.0'}}, {install: {}}, {worldId: ''}]) {
    assert.throws(() => validateFixture({...fixture(), ...change}), /invalid-fixture/);
  }
  assert.throws(() => makeBenchmarkMacro(fixture(), 'off', 1, 'ten-hit'), /invalid-workload/);
  assert.throws(() => makeBenchmarkMacro(fixture(), 'rpg-numbers', 1, 'burst100'), /invalid-workload/);
  new vm.Script(makeQaMacro(fixture()));
  new vm.Script(makeBenchmarkMacro(fixture(), 'baseline', 1, 'burst100'));
});

test('real CLI refuses the synthetic example and reports failure without a stack or fixture values', () => {
  const result = spawnSync(process.execPath, ['tools/live-qa.mjs', 'emit', '--fixture=tests/fixtures/qa-example.json'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /QA generation failed/);
  assert.doesNotMatch(result.stderr, /REPLACE_LOCAL_WORLD|at validateFixture/);
});

test('real CLI emits an executable self-contained benchmark for a locally bound fixture', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'combat-pulse-tools-'));
  const path = join(directory, 'fixture.json');
  try {
    writeFileSync(path, JSON.stringify(fixture()));
    const result = spawnSync(process.execPath, ['tools/benchmark.mjs', 'emit', `--fixture=${path}`, '--variant=baseline', '--pair=1', '--workload=burst100'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const {sandbox} = browser();
    const report = await vm.runInNewContext(result.stdout, sandbox);
    assert.equal(report.status, 'complete');
    assert.equal(report.work.displayed, 100);
  } finally {
    unlinkSync(path);
    rmdirSync(directory);
  }
});

test('emitted QA executes actual system methods and restores fixture, settings, and pause', async () => {
  const {fake, sandbox, listeners} = browser();
  const original = structuredClone(fake.actor.system.attributes.hp);
  const originalSettings = {...fake.values};
  const input = fixture();
  Object.assign(input.settings, {reactions: true, shake: true, reducedMotion: true});
  input.machine.privateField = 'private-name';
  input.install.privateField = 'private-install';
  const report = await vm.runInNewContext(makeQaMacro(input), sandbox);
  assert.equal(report.status, 'complete');
  assert.equal(report.work.completed, 3);
  assert.deepEqual(Array.from(report.assertions, value => value.status), ['passed', 'passed', 'passed']);
  assert.deepEqual(fake.actor.system.attributes.hp, original);
  assert.deepEqual(fake.values, originalSettings);
  assert.equal(fake.game.paused, true);
  assert.equal(listeners.size, 0);
  assert.doesNotMatch(JSON.stringify(report), /Actor\.a|Scene\.s|worldId|actorId|tokenId|rawChat|private-name|private-install/);
});

test('mismatched fixture stops before update, pause, or settings changes', async () => {
  const {fake, sandbox} = browser();
  fake.actor.update = () => assert.fail('must not mutate');
  fake.game.togglePause = () => assert.fail('must not pause');
  fake.game.settings.set = () => assert.fail('must not change settings');
  const report = await vm.runInNewContext(makeQaMacro({...fixture(), worldId: 'another'}), sandbox);
  assert.equal(report.status, 'failed');
  assert.equal(report.work.attempted, 0);
  assert.equal(report.cleanup.status, 'not-needed');
});

for (const system of ['pf2e', 'sf2e', 'dnd5e']) {
  test(`${system} QA requires agreement with exactly one finite system roll`, async () => {
    const input = {...fixture(), system: {id: system, version: {pf2e: '8.6.1', sf2e: '1.6.1', dnd5e: '6.0.6'}[system]}};
    const valid = system === 'dnd5e' ? [{total: 24}] : {total: 24};
    const invalid = system === 'dnd5e'
      ? [[{total: 999}], null, undefined, [], [{total: 24}, {total: 24}], [{total: NaN}], [{total: '24'}]]
      : [{total: 999}, null, undefined, [{total: 24}], {total: Infinity}, {total: '24'}];
    for (const result of [valid, ...invalid]) {
      const {fake, sandbox, listeners} = browser(system);
      const original = structuredClone(fake.actor.system.attributes.hp);
      const target = system === 'dnd5e' ? fake.actor : fake.game.pf2e.Check;
      const key = system === 'dnd5e' ? 'rollAbilityCheck' : 'roll';
      const roll = target[key];
      target[key] = async (...args) => { await roll(...args); return result; };
      const report = await vm.runInNewContext(makeQaMacro(input), sandbox);
      assert.equal(report.status, result === valid ? 'complete' : 'failed', JSON.stringify(result));
      if (result === valid) assert.equal(report.assertions.at(-1).status, 'passed');
      if (result?.total === 999 || result?.[0]?.total === 999) assert.equal(report.assertions.at(-1).status, 'failed');
      assert.equal(report.cleanup.status, 'complete');
      assert.deepEqual(fake.actor.system.attributes.hp, original);
      assert.equal(fake.game.paused, true);
      assert.equal(listeners.size, 0);
      assert.doesNotMatch(JSON.stringify(report), /:\s*999\s*[,}\]]|"total"/);
    }
  });
}

test('QA rejects duplicate check displays even when both show the actual total', async () => {
  const {fake, sandbox} = browser();
  const roll = fake.game.pf2e.Check.roll;
  fake.game.pf2e.Check.roll = async () => {
    const result = await roll();
    fake.Hooks.call('createChatMessage', fake.message('duplicate-check', {pf2e: {context: {type: 'attack-roll', outcome: 'success'}}}));
    return result;
  };
  const report = await vm.runInNewContext(makeQaMacro(fixture()), sandbox);
  assert.equal(report.status, 'failed');
  assert.equal(report.assertions.at(-1).status, 'failed');
  assert.equal(report.cleanup.status, 'complete');
});

test('system action failure retains primary failure and independently attempts every restoration', async () => {
  const {fake, sandbox, listeners} = browser();
  const restored = [];
  fake.actor.applyDamage = async () => { throw new Error('private actor name'); };
  const update = fake.actor.update;
  let updates = 0;
  fake.actor.update = async changes => {
    if (++updates > 1) throw new Error('private cleanup');
    await update(changes); restored.push('actor');
  };
  fake.game.togglePause = async value => { restored.push('pause'); fake.game.paused = value; };
  fake.game.settings.set = async (_id, key, value) => { restored.push(key); fake.values[key] = value; };
  const report = await vm.runInNewContext(makeQaMacro(fixture()), sandbox);
  assert.equal(report.status, 'failed');
  assert.equal(report.work.attempted, 1);
  assert.equal(report.work.completed, 0);
  assert.equal(report.work.rejected, 1);
  assert.equal(report.cleanup.status, 'failed');
  assert.ok(report.cleanup.failedSteps.includes('actor-hp'));
  assert.equal(fake.game.paused, true);
  assert.ok(restored.filter(value => value === 'reducedMotion').length === 2);
  assert.equal(listeners.size, 0);
  assert.doesNotMatch(JSON.stringify(report), /private actor|private cleanup/);
});

test('emitted renderer burst accounts for all work, differences, expiry, observers, and idle cleanup', async () => {
  const {fake, sandbox, observers, rafs} = browser();
  const report = await vm.runInNewContext(makeBenchmarkMacro(fixture(), 'baseline', 1, 'burst100'), sandbox);
  assert.equal(report.status, 'complete');
  assert.equal(report.work.accepted, 100);
  assert.equal(report.work.displayed, 100);
  assert.equal(report.work.evicted, 68);
  assert.equal(report.work.maxActive, 32);
  assert.equal(report.samples.dispatchMs.length, 100);
  assert.equal(report.resources.afterClear.ownedLayers, 0);
  assert.equal(report.idleDiagnosticFrames, 0);
  assert.equal(observers.size, 0);
  assert.equal(rafs.size, 0);
  assert.equal(fake.game.paused, true);
});

test('emitted benchmark brackets blocked dispatch with actual observed frames', async () => {
  const {fake, pulse, sandbox, block, rafs} = browser();
  fake.game.modules.get('combat-pulse').api = {...pulse, show(effect) { block(1); return pulse.show(effect); }};
  const report = await vm.runInNewContext(makeBenchmarkMacro(fixture(), 'baseline', 1, 'burst100'), sandbox);
  assert.equal(report.status, 'complete');
  assert.equal(report.samples.frameTimestampsMs[0], report.windowStartedMs);
  assert.equal(report.samples.frameTimestampsMs.at(-1), report.windowFinishedMs);
  assert.ok(report.samples.frameIntervalsMs.some(value => value >= 2100));
  assert.equal(report.samples.dispatchMs.reduce((total, value) => total + value, 0), 100);
  assert.equal(rafs.size, 0);
});

test('benchmark thrown API call restores observers and records failed work in its denominator', async () => {
  const {fake, sandbox, observers, rafs, pulse} = browser();
  fake.game.modules.get('combat-pulse').api = {...pulse, show() { throw new Error('private payload'); }};
  const report = await vm.runInNewContext(makeBenchmarkMacro(fixture(), 'head', 1, 'ten-hit'), sandbox);
  assert.equal(report.status, 'failed');
  assert.equal(report.work.attempted, 1);
  assert.equal(report.work.completed, 0);
  assert.equal(report.work.rejected, 1);
  assert.equal(report.cleanup.status, 'complete');
  assert.equal(observers.size, 0);
  assert.equal(rafs.size, 0);
  assert.doesNotMatch(JSON.stringify(report), /private payload/);
});

test('module-off system workload executes ten actual actions without using the renderer API', async () => {
  const {fake, sandbox} = browser();
  fake.game.modules.get('combat-pulse').active = false;
  fake.game.modules.get('combat-pulse').api = {show() { assert.fail('API called'); }};
  fake.game.settings.set = () => assert.fail('disabled module settings changed');
  let actions = 0;
  fake.actor.applyDamage = async () => { actions++; fake.actor.system.attributes.hp.value--; };
  const report = await vm.runInNewContext(makeBenchmarkMacro(fixture(), 'off', 1, 'system-ten-hit'), sandbox);
  assert.equal(report.status, 'complete');
  assert.equal(actions, 10);
  assert.equal(report.work.displayed, null);
  assert.equal(report.actionProvenance, 'system-method');
});

for (const variant of ['baseline', 'head', 'current', 'off', 'rpg-numbers']) {
  test(`${variant} system-ten-hit applies ten HP-only hits from 40 HP and zero temporary HP`, async () => {
    const {fake, sandbox} = browser();
    const original = structuredClone(fake.actor.system.attributes.hp);
    const input = fixture();
    if (['off', 'rpg-numbers'].includes(variant)) fake.game.modules.get('combat-pulse').active = false;
    if (variant === 'rpg-numbers') {
      input.comparator = {moduleId: 'rpg-numbers', version: '14.1.5', smokeVerified: true, settingsReceipt: 'numeric-only'};
      fake.game.modules.set('rpg-numbers', {id: 'rpg-numbers', active: true, version: '14.1.5'});
    }
    const beforeHits = [];
    const damage = fake.actor.applyDamage;
    fake.actor.applyDamage = async options => {
      const {value, temp} = fake.actor.system.attributes.hp;
      beforeHits.push({value, temp, damage: options.damage});
      await damage(options);
    };
    const report = await vm.runInNewContext(makeBenchmarkMacro(input, variant, 1, 'system-ten-hit'), sandbox);
    assert.deepEqual(beforeHits, Array.from({length: 10}, (_, index) => ({value: 40 - index, temp: 0, damage: 1})));
    assert.equal(report.status, 'complete');
    assert.equal(report.work.completed, 10);
    assert.equal(report.work.accepted, 10);
    assert.equal(report.cleanup.status, 'complete');
    assert.deepEqual(fake.actor.system.attributes.hp, original);
  });
}

test('system workload rejects a resolved method that completes no HP work', async () => {
  const {fake, sandbox} = browser();
  fake.game.modules.get('combat-pulse').active = false;
  fake.actor.applyDamage = async () => {};
  const report = await vm.runInNewContext(makeBenchmarkMacro(fixture(), 'off', 1, 'system-ten-hit'), sandbox);
  assert.equal(report.status, 'failed');
  assert.equal(report.work.attempted, 1);
  assert.equal(report.work.accepted, 0);
  assert.equal(report.work.rejected, 1);
  assert.equal(report.cleanup.status, 'complete');
});

function reports() {
  const diagnostics = displayed => ({active: 0, banners: 0, ticking: false, ownedLayers: 0, displayed, evicted: 0, frames: 100});
  return Array.from({length: 10}, (_, index) => {
    const pair = Math.floor(index / 2) + 1;
    const variant = (pair % 2 ? ['baseline', 'head'] : ['head', 'baseline'])[index % 2];
    return {schema: 1, kind: 'benchmark', status: 'complete', pair, variant, actionProvenance: 'renderer-api',
      startedAt: new Date(100000 + index * 10000).toISOString(), finishedAt: new Date(105000 + index * 10000).toISOString(),
      metadata: {schema: 1, runId: `run-${index}`, clientId: 'gm', fixtureId: 'scene-a', foundry: '14.369', system: {id: 'pf2e', version: '8.6.1'},
        install: {sha: (variant === 'baseline' ? 'a' : 'b').repeat(40), packageHash: (variant === 'baseline' ? 'c' : 'd').repeat(64), dirty: false, receipt: variant},
        machine: fixture().machine, browser: 'test', viewport: {width: 1200, height: 800}, devicePixelRatio: 1,
        renderer: {type: 1, width: 1200, height: 800, pixi: '7.4.3'}, scene: {width: 2000, height: 1500, grid: 100, tokenCount: 1, zoom: 1, tokenWidth: 100, tokenHeight: 100},
        modules: [{id: 'combat-pulse', version: '0.1.0'}], settings: fixture().settings, effectiveReducedMotion: false, browserReducedMotion: false,
        visibility: 'visible', workload: 'ten-hit', workloadVersion: 1, cadenceMs: 250, warmupMs: 250, measurementMode: 'uninstrumented'},
      work: {attempted: 10, completed: 10, accepted: 10, rejected: 0, displayed: 10, evicted: 0, maxActive: 5, maxBanners: 0},
      samples: {dispatchMs: Array(10).fill(variant === 'baseline' ? 2 : 1), frameIntervalsMs: [16, 4468], frameTimestampsMs: [100, 116, 4584], dispatchToRenderCompleteMs: [15]},
      resources: {before: diagnostics(5), afterBurst: diagnostics(15), afterExpiry: diagnostics(15), afterClear: diagnostics(15)},
      windowStartedMs: 99, windowFinishedMs: 4600, idleDiagnosticFrames: 0, errors: {count: 0, codes: []}, cleanup: {status: 'complete', failedSteps: []}, unavailable: []};
  });
}

test('nearest-rank quantiles preserve raw input and reject absent or invalid samples', () => {
  const sample = [4, 1, 3, 2];
  assert.equal(quantile(sample, 0.5), 2);
  assert.equal(quantile(sample, 0.95), 4);
  assert.deepEqual(sample, [4, 1, 3, 2]);
  assert.throws(() => quantile([], 0.95), /invalid-samples/);
  assert.throws(() => quantile([NaN], 0.95), /invalid-samples/);
});

test('comparator accepts chronological alternating pairs and retains pair and pooled summaries', () => {
  const comparison = compareRuns(reports().reverse());
  assert.equal(comparison.status, 'comparable');
  assert.equal(comparison.pairs.length, 5);
  assert.deepEqual(comparison.pairs[1].order, ['head', 'baseline']);
  assert.equal(comparison.pairs[0].summaries.dispatchMs.p95DeltaMs, -1);
  assert.equal(comparison.summaries[0].baseline.count, 50);
  assert.equal(comparison.budgets.status, 'uncalibrated');
});

test('comparator rejects truncated sampling at either window edge', () => {
  for (const timestamps of [[100, 116], [4568, 4584]]) {
    const data = reports();
    for (const report of data) {
      report.samples.frameTimestampsMs = timestamps;
      report.samples.frameIntervalsMs = [16];
    }
    const result = compareRuns(data);
    assert.equal(result.status, 'inconclusive');
    assert.deepEqual(result.reasons, ['incomplete-frame-coverage']);
    assert.deepEqual(result.summaries, []);
  }
});

test('comparator retains slow cadence and interior stalls with complete window coverage', () => {
  const data = reports();
  for (const report of data) {
    report.samples.frameTimestampsMs = [100, 1100, 2100, 3100, 4100];
    report.samples.frameIntervalsMs = [1000, 1000, 1000, 1000];
  }
  const result = compareRuns(data);
  assert.equal(result.status, 'comparable');
  assert.equal(result.summaries[1].baseline.p95, 1000);
  assert.equal(result.summaries[1].baseline.count, 20);
  assert.equal(compareRuns(reports()).summaries[1].baseline.p95, 4468);
});

test('comparator rejects incomplete, unequal, erroneous, synthetic, and wrongly interleaved evidence', () => {
  const cases = [
    data => data.pop(),
    data => { data[0].metadata.machine.cpu = ''; },
    data => { data[0].metadata.scene.tokenCount = 2; },
    data => { data[0].metadata.settings.shake = true; },
    data => { data[0].work.completed = 9; },
    data => { data[0].work.rejected = 1; },
    data => { data[0].samples.dispatchMs.pop(); },
    data => { data[0].samples.frameTimestampsMs[1] = 117; },
    data => { data[0].windowFinishedMs = 200; },
    data => { data[0].samples.dispatchToRenderCompleteMs = []; data[0].unavailable = [{metric: 'dispatchToRenderCompleteMs', reasonCode: 'unsupported'}]; },
    data => { data[0].metadata.install.dirty = true; },
    data => { data[0].errors.count = 1; },
    data => { data[0].cleanup.status = 'failed'; },
    data => { data[0].resources.afterClear.ticking = true; },
    data => { data[0].variant = 'head'; },
    data => { data[0].metadata.runId = data[1].metadata.runId; },
    data => { data[0].finishedAt = data[1].finishedAt; }
  ];
  for (const mutate of cases) {
    const data = reports(); mutate(data);
    const comparison = compareRuns(data);
    assert.equal(comparison.status, 'inconclusive', mutate.toString());
    assert.equal(comparison.summaries.length, 0);
    assert.equal(comparison.reasons.length, 1);
  }
});

test('unavailable render completion stays unavailable rather than becoming zero', () => {
  const data = reports();
  for (const report of data) {
    report.samples.dispatchToRenderCompleteMs = [];
    report.unavailable = [{metric: 'dispatchToRenderCompleteMs', reasonCode: 'postrender-unavailable'}];
  }
  const comparison = compareRuns(data);
  assert.equal(comparison.status, 'comparable');
  assert.deepEqual(comparison.summaries[2], {metric: 'dispatchToRenderCompleteMs', status: 'unavailable'});
});
