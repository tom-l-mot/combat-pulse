import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function validateFixture(input) {
  const fail = () => { throw new Error('invalid-fixture'); };
  const text = value => typeof value === 'string' && value.length > 0 && value.length <= 200;
  if (!input || input.schema !== 1 || input.disposable !== true || input.synthetic !== false) fail();
  for (const key of ['worldId', 'sceneId', 'actorId', 'tokenId', 'fixtureId', 'runId', 'clientId']) {
    if (!text(input[key]) || !/^[a-zA-Z0-9_-]+$/.test(input[key]) || input[key].startsWith('REPLACE_')) fail();
  }
  const supported = {pf2e: '8.6.1', sf2e: '1.6.1', dnd5e: '6.0.6'};
  if (!input.system || supported[input.system.id] !== input.system.version) fail();
  if (!/^[a-f0-9]{40}$/.test(input.install?.sha) || typeof input.install.dirty !== 'boolean'
    || !/^[a-f0-9]{64}$/.test(input.install.packageHash) || !text(input.install.receipt)) fail();
  if (/^0+$/.test(input.install.sha) || /^0+$/.test(input.install.packageHash)) fail();
  for (const key of ['label', 'cpu', 'ram', 'gpu', 'os', 'browserVersion']) {
    if (!text(input.machine?.[key]) || input.machine[key].startsWith('REPLACE_')) fail();
  }
  for (const key of ['enabled', 'numbers', 'checks', 'banners', 'reactions', 'shake', 'reducedMotion']) {
    if (typeof input.settings?.[key] !== 'boolean') fail();
  }
  if (!input.settings.enabled || !input.settings.numbers) fail();
  return input;
}

export function browserContext(fixture, variant = 'current') {
  const require = (value, code) => { if (!value) throw new Error(code); };
  const keys = ['enabled', 'numbers', 'checks', 'banners', 'reactions', 'shake', 'reducedMotion'];
  require(game.world?.id === fixture.worldId && canvas.ready && canvas.scene?.id === fixture.sceneId, 'fixture-context');
  require(game.system.id === fixture.system.id && game.system.version === fixture.system.version, 'fixture-system');
  require(document.visibilityState === 'visible', 'client-background');
  const token = canvas.tokens.placeables.find(value => value.id === fixture.tokenId);
  const actor = token?.actor;
  require(actor?.id === fixture.actorId && (game.user.isGM || actor.isOwner), 'fixture-actor');
  require(token.visible === true && token.document.parent?.id === fixture.sceneId && !token.document.hidden && !token.detectionFilter, 'fixture-token');
  require(canvas.tokens.placeables.filter(value => value.actor?.uuid === actor.uuid && value.visible && !value.document.hidden).length === 1,
    'fixture-ambiguous');
  const hp = actor.system?.attributes?.hp;
  require(hp?.max === 40 && Number.isFinite(hp.value) && Number.isFinite(hp.temp), 'fixture-hp');
  require(typeof actor.update === 'function' && typeof actor.applyDamage === 'function', 'system-method-unavailable');
  const pulseModule = game.modules.get('combat-pulse');
  const pulse = pulseModule?.active ? pulseModule.api : null;
  if (['off', 'rpg-numbers'].includes(variant)) require(!pulseModule?.active, 'variant-module-enabled');
  else require(pulse && !pulse.diagnostics().active && !pulse.diagnostics().banners
    && !pulse.diagnostics().ticking && !pulse.diagnostics().ownedLayers, 'module-not-idle');
  if (variant === 'rpg-numbers') {
    require(game.system.id === 'pf2e' && fixture.comparator?.smokeVerified === true
      && game.modules.get(fixture.comparator.moduleId)?.active
      && game.modules.get(fixture.comparator.moduleId)?.version === fixture.comparator.version
      && typeof fixture.comparator.settingsReceipt === 'string', 'comparator-unverified');
  }
  const original = {hp: hp.value, temp: hp.temp, paused: game.paused,
    settings: pulse ? Object.fromEntries(keys.map(key => [key, game.settings.get('combat-pulse', key)])) : {}};
  const errors = {count: 0, codes: []};
  const error = code => { errors.count++; errors.codes.push(code); };
  const onError = () => error('browser-error');
  const onRejection = () => error('browser-rejection');
  const onVisibility = () => { if (document.visibilityState !== 'visible') error('client-background'); };
  let listening = false;
  const snapshot = () => pulse ? {...pulse.diagnostics()} : null;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const labels = () => {
    const result = [];
    const walk = node => {
      if (typeof node.text === 'string') result.push(node.text);
      for (const child of node.children ?? []) walk(child);
    };
    for (const node of canvas.interface.children) if (!initialLayers.has(node)) walk(node);
    return result;
  };
  const initialLayers = new Set(canvas.interface.children);
  return {
    pulse, actor, token, errors, error, require, snapshot, delay, labels,
    async prepare() {
      window.addEventListener('error', onError);
      window.addEventListener('unhandledrejection', onRejection);
      document.addEventListener('visibilitychange', onVisibility);
      listening = true;
      if (original.paused) await game.togglePause(false, {broadcast: true});
      for (const key of Object.keys(original.settings)) await game.settings.set('combat-pulse', key, fixture.settings[key]);
      await delay(250);
    },
    async seed(temp = 8) { await actor.update({'system.attributes.hp.value': 40, 'system.attributes.hp.temp': temp}); pulse?.clear(); },
    async damage(amount) {
      if (game.system.id === 'dnd5e') await actor.applyDamage(amount);
      else await actor.applyDamage({damage: amount, token: token.document, skipIWR: true});
    },
    async check() {
      if (game.system.id === 'dnd5e') {
        require(typeof actor.rollAbilityCheck === 'function', 'system-check-unavailable');
        await actor.rollAbilityCheck({ability: 'str'}, {configure: false});
      } else {
        const api = game.pf2e;
        require(typeof api?.Check?.roll === 'function' && typeof api.CheckModifier === 'function', 'system-check-unavailable');
        await api.Check.roll(new api.CheckModifier('Disposable QA', {modifiers: []}), {
          actor, token: token.document, type: 'attack-roll', dc: {value: 15},
          options: new Set(['item:ranged']), skipDialog: true, createMessage: true
        });
      }
    },
    metadata(workload, cadenceMs) {
      const screen = canvas.app.renderer.screen;
      const scene = canvas.scene;
      return {
        schema: 1, runId: fixture.runId, clientId: fixture.clientId, fixtureId: fixture.fixtureId,
        foundry: game.version, system: {id: fixture.system.id, version: fixture.system.version},
        install: Object.fromEntries(['sha', 'dirty', 'packageHash', 'receipt'].map(key => [key, fixture.install[key]])),
        machine: Object.fromEntries(['label', 'cpu', 'ram', 'gpu', 'os', 'browserVersion'].map(key => [key, fixture.machine[key]])),
        browser: navigator.userAgent, viewport: {width: innerWidth, height: innerHeight}, devicePixelRatio,
        renderer: {type: canvas.app.renderer.type, width: screen.width, height: screen.height, pixi: PIXI.VERSION},
        scene: {width: scene.width, height: scene.height, grid: scene.grid.size,
          tokenCount: canvas.tokens.placeables.length, zoom: canvas.stage.scale.x,
          tokenWidth: token.w, tokenHeight: token.h},
        modules: [...game.modules.values()].filter(value => value.active).map(value => ({id: value.id, version: value.version}))
          .sort((a, b) => a.id.localeCompare(b.id)),
        settings: pulse ? Object.fromEntries(keys.map(key => [key, game.settings.get('combat-pulse', key)])) : null,
        comparator: variant === 'rpg-numbers' ? {moduleId: fixture.comparator.moduleId,
          version: fixture.comparator.version, settingsReceipt: fixture.comparator.settingsReceipt} : null,
        effectiveReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches || Boolean(pulse && game.settings.get('combat-pulse', 'reducedMotion')),
        browserReducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        visibility: document.visibilityState, workload, workloadVersion: 1, cadenceMs, warmupMs: 250, measurementMode: 'uninstrumented'
      };
    },
    async restore() {
      const failedSteps = [];
      const attempt = async (id, action) => { try { await action(); } catch { failedSteps.push(id); } };
      if (listening) {
        await attempt('error-observer', () => window.removeEventListener('error', onError));
        await attempt('rejection-observer', () => window.removeEventListener('unhandledrejection', onRejection));
        await attempt('visibility-observer', () => document.removeEventListener('visibilitychange', onVisibility));
      }
      await attempt('clear-before', () => pulse?.clear());
      await attempt('actor-hp', () => actor.update({'system.attributes.hp.value': original.hp, 'system.attributes.hp.temp': original.temp}));
      await attempt('pause', () => game.togglePause(original.paused, {broadcast: true}));
      for (const key of Object.keys(original.settings)) await attempt(`setting-${key}`, () => game.settings.set('combat-pulse', key, original.settings[key]));
      await attempt('clear-after', () => pulse?.clear());
      await attempt('idle', () => {
        const state = snapshot();
        require(!state || (!state.active && !state.banners && !state.ticking && !state.ownedLayers), 'cleanup-not-idle');
      });
      return {status: failedSteps.length ? 'failed' : 'complete', failedSteps};
    }
  };
}

export async function runSystemQa(fixture, context = browserContext) {
  const report = {schema: 1, kind: 'system-qa', status: 'failed', actionProvenance: 'system-method',
    lane: 'system-actions', startedAt: new Date().toISOString(), assertions: [],
    evidence: {uiReceiptRequired: true, screenshotReferences: [], counterpartRunIds: []},
    work: {attempted: 0, completed: 0, rejected: 0, displayed: 0}, errors: {count: 0, codes: []},
    cleanup: {status: 'not-needed', failedSteps: []}};
  let owner;
  try {
    validateFixture(fixture);
    owner = context(fixture);
    report.errors = owner.errors;
    await owner.prepare();
    report.metadata = owner.metadata('system-actions', 0);
    owner.require(fixture.settings.checks, 'checks-disabled');
    const assert = (id, value) => { report.assertions.push({id, status: value ? 'passed' : 'failed'}); owner.require(value, 'assertion-failed'); };
    const action = async callback => { report.work.attempted++; await callback(); report.work.completed++; };
    await owner.seed();
    let before = owner.snapshot();
    await action(() => owner.damage(10));
    assert('damage-components-once', owner.snapshot().displayed - before.displayed === 1 && owner.labels().includes('-2\nTemp -8'));
    report.work.displayed += owner.snapshot().displayed - before.displayed;
    owner.pulse.clear();
    before = owner.snapshot();
    await action(() => owner.damage(-5));
    assert('capped-healing', owner.labels().includes('+2'));
    report.work.displayed += owner.snapshot().displayed - before.displayed;
    owner.pulse.clear();
    before = owner.snapshot();
    await action(() => owner.check());
    assert('check-total', owner.snapshot().displayed > before.displayed && owner.labels().some(value => /^\d+/.test(value)));
    report.work.displayed += owner.snapshot().displayed - before.displayed;
    report.status = 'complete';
  } catch {
    if (owner) owner.error('system-qa-failed');
    else { report.errors.count++; report.errors.codes.push('fixture-rejected'); }
  } finally {
    report.work.rejected = report.work.attempted - report.work.completed;
    if (owner) report.cleanup = await owner.restore();
    if (report.cleanup.status === 'failed' || report.errors.count) report.status = 'failed';
    report.finishedAt = new Date().toISOString();
  }
  return report;
}

export function makeQaMacro(fixture) {
  validateFixture(fixture);
  return `(() => { const validateFixture = ${validateFixture.toString()}; const browserContext = ${browserContext.toString()}; return (${runSystemQa.toString()})(${JSON.stringify(fixture)}); })()`;
}

export function cliOptions(args) {
  const options = {};
  for (const arg of args) {
    const match = /^--([a-z]+)=(.+)$/.exec(arg);
    if (!match || options[match[1]]) throw new Error('invalid-arguments');
    options[match[1]] = match[2];
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = cliOptions(process.argv.slice(3));
    if (process.argv[2] !== 'emit' || Object.keys(options).some(key => key !== 'fixture') || !options.fixture) throw new Error('invalid-arguments');
    process.stdout.write(makeQaMacro(JSON.parse(readFileSync(options.fixture, 'utf8'))) + '\n');
  } catch { console.error('QA generation failed. Use: node tools/live-qa.mjs emit --fixture=<local.json>'); process.exitCode = 1; }
}
