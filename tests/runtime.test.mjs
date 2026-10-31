import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from '../scripts/main.js';
import {runtime} from './fake-runtime.mjs';
import {DEFINITIONS} from '../scripts/settings.js';

globalThis.foundry = {applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: value => value}}};

function setup(system = 'sf2e') {
  const r = runtime(system);
  r.Hooks.once('init', () => { r.api = install({...r, canvas: () => r.canvas}); });
  r.Hooks.call('init');
  r.Hooks.call('canvasReady');
  r.Hooks.call('ready');
  return r;
}
const health = {kind: 'health', tokenUuid: 'Scene.s.Token.t', hpDelta: -2, tempDelta: -8};

test('settings registration uses the shared definitions and opens the preview application', () => {
  const r = setup();
  const registered = r.registrations;
  const menu = r.menus.get('preview');
  assert.equal(registered.size, 10);
  for (const definition of DEFINITIONS) {
    assert.equal(registered.get(definition.key).default, definition.default);
    assert.equal(registered.get(definition.key).scope, definition.scope);
  }
  assert.equal(menu.restricted, false);
  assert.equal(menu.type.PARTS.body.template, 'modules/combat-pulse/templates/settings.hbs');
  r.api.show(health);
  registered.get('enabled').onChange();
  assert.equal(r.api.diagnostics().active, 0);
  assert.equal(r.callbacks.size, 0);
});

test('entrypoint binds the replacement game during init before canvasReady and ready', async t => {
  const r = runtime();
  const names = ['Hooks', 'game', 'canvas', 'PIXI'];
  const previous = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const name of names) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  });
  Object.assign(globalThis, {Hooks: r.Hooks, game: {}, canvas: r.canvas, PIXI: r.PIXI});
  await import('../scripts/main.js?startup-regression');
  globalThis.game = r.game;
  r.Hooks.call('init');
  assert.equal(r.registrations.size, 10);
  assert.equal(r.menus.get('preview').restricted, false);
  r.Hooks.call('canvasReady');
  r.Hooks.call('ready');
  const api = r.game.modules.get('combat-pulse').api;
  assert.deepEqual(api.preview('health'), {shown: true});
  assert.equal(r.canvas.interface.children[0].children[0].children[0].text, '-7\nTemp -3');
  api.clear();
  assert.equal(r.callbacks.size, 0);
});

test('PF-family result visibility preserves totals and only authorized outcome labels and banners', () => {
  for (const system of ['pf2e', 'sf2e']) {
    for (const isGM of [false, true]) {
      for (const results of [false, true, undefined]) {
        const r = setup(system);
        r.game.user.isGM = isGM;
        if (results === undefined) delete r.game.pf2e;
        else r.game.pf2e.settings.metagame.results = results;
        r.Hooks.call('createChatMessage', r.message('outcome', {
          [system]: {context: {type: 'attack-roll', outcome: 'criticalSuccess'}}
        }));
        const labels = r.canvas.interface.children[0].children.flatMap(node =>
          node.children.filter(child => typeof child.text === 'string').map(child => child.text));
        const allowed = isGM || results === true;
        assert.deepEqual(labels, allowed ? ['24\nCritical success', 'Critical success!'] : ['24'],
          `${system}, GM=${isGM}, results=${results}`);
        assert.equal(r.api.diagnostics().banners, allowed ? 1 : 0);
        r.api.clear();
      }
    }
  }
});

test('detection-only tokens expose no effects or raw texture, including during active visuals', () => {
  const r = setup();
  r.values.reactions = true;
  r.values.shake = true;
  const filter = {knockout: true};
  const texture = r.token.mesh.texture;
  r.token.detectionFilter = filter;
  let textureReads = 0;
  Object.defineProperty(r.token.mesh, 'texture', {get() { textureReads++; return texture; }});
  assert.deepEqual(r.api.show(health), {shown: false, reason: 'not-visible'});
  assert.deepEqual(r.api.show({kind: 'banner', tokenUuid: health.tokenUuid, text: 'Hidden', tone: 'danger'}),
    {shown: false, reason: 'not-visible'});
  r.Hooks.call('createChatMessage', r.message('detected'));
  assert.equal(textureReads, 0);
  assert.equal(r.canvas.interface.children.length, 0);
  r.token.detectionFilter = null;
  assert.deepEqual(r.api.preview('critical'), {shown: true});
  const layer = r.canvas.interface.children[0];
  const echo = layer.children[0].children.find(child => child.texture === texture);
  assert.equal(echo.texture, texture);
  assert.equal(r.api.diagnostics().banners, 1);
  r.token.detectionFilter = filter;
  r.advance(20);
  assert.equal(echo.destroyed, true);
  assert.equal(r.api.diagnostics().active, 0);
  assert.equal(r.api.diagnostics().banners, 0);
  assert.equal(r.callbacks.size, 0);
  assert.equal(r.canvas.interface.children.length, 0);
  assert.equal(r.token.detectionFilter, filter);
  assert.deepEqual(texture, {shared: true});
});

test('public API previews display literal text without document changes and no idle ticker', () => {
  const r = setup();
  assert.equal(r.callbacks.size, 0);
  assert.equal(r.api.diagnostics().ownedLayers, 0);
  assert.deepEqual(r.api.preview('health'), {shown: true});
  const layer = r.canvas.interface.children[0];
  assert.equal(layer.children[0].children[0].text, '-7\nTemp -3');
  assert.deepEqual(r.actor.system.attributes.hp, {value: 40, temp: 8});
  assert.equal(r.callbacks.size, 1);
  r.advance(1300);
  assert.deepEqual(r.api.diagnostics(), {active: 0, banners: 0, ticking: false, displayed: 1,
    evicted: 0, frames: 1, ownedLayers: 0, rememberedMessages: 0});
  assert.equal(r.canvas.interface.children.length, 0);
  assert.deepEqual(r.api.show({kind: 'nope'}), {shown: false, reason: 'invalid'});
});

test('one message renders once, distinct identical applications render separately', () => {
  const r = setup();
  const message = r.message();
  r.Hooks.call('createChatMessage', message);
  r.Hooks.call('createChatMessage', message);
  r.Hooks.call('createChatMessage', r.message('second'));
  assert.equal(r.api.diagnostics().active, 2);
  assert.equal(r.api.diagnostics().displayed, 2);
  assert.equal(r.api.diagnostics().rememberedMessages, 2);
  assert.equal(r.handlers.get('updateActor').length, 1);
  assert.equal(r.handlers.has('dnd5e.damageActor'), false);
});

test('unreadable messages never extract flags or display banners', () => {
  const r = setup();
  const privateMessage = {...r.message(), isContentVisible: false};
  Object.defineProperty(privateMessage, 'flags', {get() { throw new Error('Private roll was accessed'); }});
  r.Hooks.call('createChatMessage', privateMessage);
  const blind = {...r.message('blind'), blind: true, author: {id: 'u'}};
  r.Hooks.call('createChatMessage', blind);
  assert.equal(r.api.diagnostics().displayed, 0);
  assert.equal(r.api.diagnostics().rememberedMessages, 0);
  r.Hooks.call('createChatMessage', r.message('public', {sf2e: {context: {type: 'attack-roll', outcome: 'criticalSuccess'}}}));
  assert.equal(r.api.diagnostics().active, 1);
  assert.equal(r.api.diagnostics().banners, 1);
});

test('critical visual and derived banner both cancel when source becomes hidden', () => {
  const r = setup();
  r.values.reactions = true;
  r.values.shake = true;
  r.api.preview('critical');
  assert.equal(r.api.diagnostics().banners, 1);
  assert.equal(r.api.diagnostics().active, 1);
  r.token.document.hidden = true;
  r.advance(20);
  assert.equal(r.api.diagnostics().banners, 0);
  assert.equal(r.api.diagnostics().active, 0);
  assert.equal(r.callbacks.size, 0);
  assert.deepEqual(r.api.show(health), {shown: false, reason: 'not-visible'});
});

test('100-event burst is bounded and resource destruction never owns shared texture', () => {
  const r = setup();
  r.values.reactions = true;
  const texture = r.token.mesh.texture;
  for (let i = 0; i < 100; i++) assert.deepEqual(r.api.show(health), {shown: true});
  for (let i = 0; i < 10; i++) r.api.preview('banner');
  assert.equal(r.api.diagnostics().active, 32);
  assert.equal(r.api.diagnostics().banners, 1);
  assert.equal(r.api.diagnostics().evicted, 68);
  assert.equal(r.callbacks.size, 1);
  const nodes = [...r.canvas.interface.children[0].children];
  const ownedText = nodes[0].children.find(child => typeof child.text === 'string');
  r.api.clear();
  assert.equal(r.callbacks.size, 0);
  assert.equal(r.canvas.interface.children.length, 0);
  assert.deepEqual(nodes[0].destroyOptions, {children: true, texture: false, baseTexture: false});
  assert.deepEqual(ownedText.destroyOptions, {texture: true, baseTexture: true});
  assert.deepEqual(texture, {shared: true});
});

test('reduced motion keeps static fade text without echo, displacement, scale pulse, or shake', () => {
  const r = setup();
  r.values.reducedMotion = true;
  r.values.reactions = true;
  r.values.shake = true;
  r.api.show(health);
  const node = r.canvas.interface.children[0].children[0];
  assert.equal(node.children.length, 1);
  assert.deepEqual({x: node.x, y: node.y}, {x: 200, y: 250});
  r.advance(700);
  assert.deepEqual({x: node.x, y: node.y}, {x: 200, y: 250});
  assert.equal(node.scale.x, 1);
  r.token.center = {x: 400, y: 500};
  r.canvas.stage.scale.x = 2;
  r.advance(100);
  assert.deepEqual({x: node.x, y: node.y}, {x: 400, y: 450});
  assert.equal(node.scale.x, 0.5);
});

test('scene change, token deletion, loss of visibility, disabling, and clear remove callback', () => {
  for (const cancel of [r => r.Hooks.call('canvasTearDown'), r => r.Hooks.call('deleteToken', r.token.document),
    r => { r.token.visible = false; r.advance(1); }, r => { r.canvas.scene.id = 'other'; r.advance(1); },
    r => { r.values.enabled = false; r.advance(1); }, r => r.api.clear()]) {
    const r = setup();
    r.api.show(health);
    cancel(r);
    assert.equal(r.callbacks.size, 0);
    assert.equal(r.api.diagnostics().active, 0);
    assert.equal(r.api.diagnostics().ownedLayers, 0);
  }
});

test('generic snapshots refresh before authorization and seed synthetic actor identity', () => {
  const r = setup('other');
  r.values.generic = true;
  r.actor.isOwner = false;
  r.actor.system.attributes.hp.value = 30;
  r.Hooks.call('updateActor', r.actor, {}, {});
  assert.equal(r.api.diagnostics().displayed, 0);
  r.actor.isOwner = true;
  r.actor.system.attributes.hp.value = 29;
  r.Hooks.call('updateActor', r.actor, {}, {});
  assert.equal(r.canvas.interface.children[0].children[0].children[0].text, '-1');
  const synthetic = {uuid: 'Scene.s.Token.synthetic.Actor.a', isToken: true, isOwner: true,
    system: {attributes: {hp: {value: 20, temp: 0}}}};
  r.token.actor = synthetic;
  r.Hooks.call('createToken', {actor: synthetic});
  synthetic.system.attributes.hp.value = 17;
  r.Hooks.call('updateActor', synthetic, {}, {});
  assert.equal(r.canvas.interface.children[0].children[1].children[0].text, '-3');
});

test('5e actor update shows zero-sum components to owner, skips non-owner and rest', () => {
  const r = setup('dnd5e');
  const options = {dnd5e: {hp: {value: 40, temp: 8}}};
  r.actor.system.attributes.hp = {value: 35, temp: 13};
  r.Hooks.call('updateActor', r.actor, {}, options);
  assert.equal(r.canvas.interface.children[0].children[0].children[0].text, '-5\nTemp +5');
  r.Hooks.call('updateActor', r.actor, {}, {...options, isRest: true});
  r.actor.isOwner = false;
  r.Hooks.call('updateActor', r.actor, {}, options);
  assert.equal(r.api.diagnostics().active, 1);
  r.game.user.isGM = true;
  r.Hooks.call('updateActor', r.actor, {}, options);
  assert.equal(r.api.diagnostics().active, 2);
});

test('5e current check messages render totals from an actor speaker without legacy flags', () => {
  const r = setup('dnd5e');
  for (const [id, skill, total] of [['ability', null, 6], ['skill', 'ath', 22]]) {
    r.Hooks.call('createChatMessage', {...r.message(id, {core: {canPopout: true}}), type: 'check',
      system: {ability: 'str', skill, tool: null, activity: null, item: null, origin: null, targets: [], type: 'ability'},
      speaker: {scene: null, actor: 'a', token: null}, rolls: [{total}]});
  }
  assert.deepEqual(r.canvas.interface.children[0].children.map(node => node.children[0].text), ['6', '22']);
  assert.equal(r.api.diagnostics().banners, 0);
});

test('PF family ignores actor updates and generic switch, and ambiguous application skips', () => {
  const r = setup();
  r.values.generic = true;
  r.actor.system.attributes.hp.value = 30;
  r.Hooks.call('updateActor', r.actor, {}, {});
  assert.equal(r.api.diagnostics().displayed, 0);
  r.canvas.tokens.placeables.push({...r.token, id: 'second', document: {uuid: 'Scene.s.Token.second', parent: {id: 's'}}});
  const message = r.message();
  message.speaker = {actor: 'different', scene: 's', token: 'missing'};
  r.Hooks.call('createChatMessage', message);
  assert.equal(r.api.diagnostics().displayed, 0);
});

test('messages without an active canvas or speaker skip safely', () => {
  const r = setup();
  const message = r.message('check', {sf2e: {context: {type: 'attack-roll', outcome: 'success'}}});
  message.speaker = undefined;
  r.canvas = undefined;
  r.Hooks.call('createChatMessage', message);
  assert.deepEqual(r.api.show(health), {shown: false, reason: 'no-canvas'});
  assert.equal(r.api.diagnostics().displayed, 0);
});
