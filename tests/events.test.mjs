import test from 'node:test';
import assert from 'node:assert/strict';
import {canReadMessage, dndHealth, hpSnapshot, messageIdentitySet, normalizeEffect, readMessage, resolveToken, snapshotStore, validPath} from '../scripts/events.js';
import {effectText} from '../scripts/render.js';
import {runtime} from './fake-runtime.mjs';

test('real SF2e HP application shape preserves signed components and capped healing', () => {
  const r = runtime();
  assert.deepEqual(readMessage(r.message(), 'sf2e'), {kind: 'health', actorUuid: 'Actor.a', hpDelta: -2, tempDelta: -8});
  const healing = r.message('heal', {sf2e: {appliedDamage: {uuid: 'Actor.a', isHealing: true,
    updates: [{path: 'system.attributes.hp.value', value: -2}]}}});
  assert.deepEqual(readMessage(healing, 'sf2e'), {kind: 'health', actorUuid: 'Actor.a', hpDelta: 2, tempDelta: 0});
  assert.equal(readMessage(r.message(), 'pf2e'), null);
  const pf = r.message('pf', {pf2e: r.message().flags.sf2e});
  assert.deepEqual(readMessage(pf, 'pf2e'), {kind: 'health', actorUuid: 'Actor.a', hpDelta: -2, tempDelta: -8});
});

test('shield, persistent creation, reverted and malformed application do not become HP loss', () => {
  const r = runtime();
  for (const appliedDamage of [
    {uuid: 'Actor.a', updates: [{path: 'system.attributes.shield.value', value: 6}], persistent: ['c']},
    {uuid: 'Actor.a', updates: [{path: 'system.attributes.hp.value', value: 7}], isReverted: true},
    {uuid: 'Actor.a', updates: [{path: 'system.attributes.hp.value', value: NaN}]},
    {uuid: 'Actor.a', updates: null},
    {uuid: 'Actor.a', updates: [null]}
  ]) assert.equal(readMessage(r.message('skip', {sf2e: {appliedDamage}}), 'sf2e'), null);
});

test('checks use exact namespaces and explicit outcome, never guessed hit or critical', () => {
  const r = runtime();
  const message = r.message('roll', {sf2e: {context: {type: 'attack-roll', outcome: 'criticalSuccess'}}});
  assert.deepEqual(readMessage(message, 'sf2e', true), {kind: 'check', total: 24, outcome: 'criticalSuccess', attack: true});
  assert.deepEqual(readMessage(message, 'sf2e'), {kind: 'check', total: 24, outcome: 'unknown', attack: true});
  message.flags.sf2e.context.outcome = 'unverified';
  assert.deepEqual(readMessage(message, 'sf2e'), {kind: 'check', total: 24, outcome: 'unknown', attack: true});
  message.rolls = [];
  assert.equal(readMessage(message, 'sf2e'), null);
  assert.deepEqual(readMessage(r.message('5e', {dnd5e: {roll: {type: 'attack'}}}), 'dnd5e'),
    {kind: 'check', total: 24, outcome: 'unknown', attack: true});
});

test('5e zero-sum HP/temp updates survive and rests or unknown prior HP skip', () => {
  const r = runtime('dnd5e');
  r.actor.system.attributes.hp = {value: 35, temp: 13};
  assert.deepEqual(dndHealth(r.actor, {dnd5e: {hp: {value: 40, temp: 8}}}), {kind: 'health', hpDelta: -5, tempDelta: 5});
  for (const options of [{}, {isRest: true, dnd5e: {hp: {value: 40, temp: 8}}},
    {isAdvancement: true, dnd5e: {hp: {value: 40, temp: 8}}}, {dnd5e: {hp: {value: 40}}}]) {
    assert.equal(dndHealth(r.actor, options), null);
  }
});

test('5e 6.0.6 ability and skill message fixtures retain totals without inventing outcomes', () => {
  for (const [skill, total] of [[null, 6], ['ath', 22]]) {
    const message = {type: 'check', system: {ability: 'str', skill, tool: null, activity: null,
      item: null, origin: null, targets: [], type: 'ability'}, flags: {core: {canPopout: true}}, rolls: [{total}]};
    assert.deepEqual(readMessage(message, 'dnd5e'), {kind: 'check', total, outcome: 'unknown', attack: false});
  }
  assert.deepEqual(readMessage({type: 'save', rolls: [{total: 17}]}, 'dnd5e'),
    {kind: 'check', total: 17, outcome: 'unknown', attack: false});
  assert.deepEqual(readMessage({type: 'attack', rolls: [{total: 20}]}, 'dnd5e'),
    {kind: 'check', total: 20, outcome: 'unknown', attack: true});
  assert.equal(readMessage({type: 'damage', rolls: [{total: 20}]}, 'dnd5e'), null);
  assert.equal(readMessage({type: 'check', rolls: [{total: Infinity}]}, 'dnd5e'), null);
});

test('generic snapshots seed and refresh, ignore max-only and invalid observations', () => {
  const r = runtime('other');
  const store = snapshotStore();
  assert.equal(store.update(r.actor), null);
  r.actor.system.attributes.hp.value = 31;
  assert.deepEqual(store.update(r.actor), {kind: 'health', hpDelta: -9, tempDelta: 0});
  r.actor.system.attributes.hp.max = 50;
  assert.equal(store.update(r.actor), null);
  r.actor.system.attributes.hp.value = Infinity;
  assert.equal(store.update(r.actor), null);
  r.actor.system.attributes.hp.value = 30;
  assert.equal(store.update(r.actor), null);
  store.delete(r.actor);
  assert.equal(store.update(r.actor), null);
  assert.equal(hpSnapshot(r.actor, 'system.attributes.hp.value', '').temp, 0);
  assert.equal(validPath('system.__proto__.value'), false);
  assert.equal(hpSnapshot(r.actor, 'system.attributes.hp.missing', ''), null);
});

test('message privacy denies hidden content, blind authors, and excluded recipients', () => {
  const user = {id: 'u', isGM: false};
  const base = {visible: true, isContentVisible: true, whisper: []};
  assert.equal(canReadMessage(base, user), true);
  assert.equal(canReadMessage({...base, isContentVisible: false}, {id: 'gm', isGM: true}), false);
  assert.equal(canReadMessage({...base, blind: true, author: {id: 'u'}, whisper: ['u']}, user), false);
  assert.equal(canReadMessage({...base, whisper: ['other']}, user), false);
  assert.equal(canReadMessage({...base, whisper: ['u']}, user), true);
  assert.equal(canReadMessage({...base, whisper: ['other'], author: {id: 'u'}}, user), true);
  assert.equal(canReadMessage({...base, blind: true, whisper: ['gm']}, {id: 'gm', isGM: true}), true);
});

test('identity cap preserves distinct equal hits and bounds remembered messages', () => {
  const identities = messageIdentitySet();
  assert.equal(identities.add('first'), true);
  assert.equal(identities.add('first'), false);
  assert.equal(identities.add('second'), true);
  for (let i = 0; i < 512; i++) identities.add(`m${i}`);
  assert.equal(identities.size, 512);
  assert.equal(identities.add('first'), true);
});

test('token resolver accepts valid speaker, skips ambiguous, hidden and off-scene tokens', () => {
  const r = runtime();
  const second = {...r.token, id: 'second'};
  assert.equal(resolveToken('Actor.a', null, [r.token, second], 's'), null);
  assert.equal(resolveToken('Actor.a', {scene: 's', token: 't'}, [r.token, second], 's'), r.token);
  assert.equal(resolveToken('Actor.other', {scene: 's', token: 't'}, [r.token], 's'), null);
  assert.equal(resolveToken('Actor.a', null, [r.token], 'different'), null);
  r.token.document.hidden = true;
  assert.equal(resolveToken('Actor.a', null, [r.token], 's'), null);
});

test('public effects reject invalid numeric/enumerated values and bound plain-text banners', () => {
  assert.deepEqual(normalizeEffect({kind: 'health', tokenUuid: 't', hpDelta: -4, tempDelta: 4}),
    {kind: 'health', tokenUuid: 't', hpDelta: -4, tempDelta: 4});
  assert.equal(normalizeEffect({kind: 'health', tokenUuid: 't', hpDelta: Infinity, tempDelta: 0}), null);
  assert.equal(normalizeEffect({kind: 'check', tokenUuid: 't', total: 20, outcome: 'hit'}), null);
  assert.equal(normalizeEffect({kind: 'banner', text: 'x'.repeat(161), tone: 'neutral'}), null);
  assert.deepEqual(normalizeEffect({kind: 'banner', text: '<b>Round 2</b>', tone: 'neutral'}),
    {kind: 'banner', text: '<b>Round 2</b>', tone: 'neutral'});
  assert.equal(effectText({kind: 'health', hpDelta: 0, tempDelta: 5}), 'Temp +5');
  assert.equal(effectText({kind: 'health', hpDelta: -2, tempDelta: -8}), '-2\nTemp -8');
});
