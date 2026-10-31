import test from 'node:test';
import assert from 'node:assert/strict';
import {install} from '../scripts/main.js';
import {runtime} from './fake-runtime.mjs';
import {DEFINITIONS} from '../scripts/settings.js';

function setup(system = 'sf2e') {
  const r = runtime(system);
  r.api = install({...r, canvas: () => r.canvas});
  r.Hooks.call('ready');
  return r;
}
const health = {kind: 'health', tokenUuid: 'Scene.s.Token.t', hpDelta: -2, tempDelta: -8};

test('settings registration uses the shared definitions and opens the preview application', () => {
  const r = setup();
  const registered = new Map();
  let menu;
  globalThis.foundry = {applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: value => value}}};
  r.game.settings.register = (_id, key, options) => registered.set(key, options);
  r.game.settings.registerMenu = (_id, _key, options) => { menu = options; };
  try {
    r.Hooks.call('init');
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
  } finally { delete globalThis.foundry; }
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
