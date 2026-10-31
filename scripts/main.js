import {canReadMessage, dndHealth, messageIdentitySet, normalizeEffect, readMessage, resolveToken, snapshotStore, tokenVisible} from './events.js';
import {createRenderer} from './render.js';
import {MODULE_ID, readPreferences, registerSettings} from './settings.js';

export function install({Hooks, game, canvas: getCanvas, PIXI, now}) {
  const snapshots = snapshotStore();
  const messages = messageIdentitySet();
  const preferences = () => readPreferences(game);
  const tokenByUuid = uuid => getCanvas()?.tokens?.placeables?.find(token => token.document.uuid === uuid);
  const renderer = createRenderer({canvas: getCanvas, token: tokenByUuid, preferences, PIXI, now});
  const generic = () => !['pf2e', 'sf2e', 'dnd5e'].includes(game.system.id) && preferences().generic;
  const seed = actor => { const prefs = preferences(); snapshots.seed(actor, prefs.hpPath, prefs.tempPath); };
  const seedAll = () => {
    snapshots.clear();
    for (const actor of game.actors ?? []) seed(actor);
    for (const token of getCanvas()?.tokens?.placeables ?? []) if (token.actor) seed(token.actor);
  };

  function show(input) {
    const effect = normalizeEffect(input);
    return effect ? renderer.show(effect) : {shown: false, reason: 'invalid'};
  }

  function dispatch(effect, token) {
    if (!token) return {shown: false, reason: 'not-visible'};
    const result = show({...effect, tokenUuid: token.document.uuid});
    if (result.shown && effect.kind === 'check' && preferences().checks && effect.outcome.startsWith('critical')) {
      show({kind: 'banner', tokenUuid: token.document.uuid,
        text: effect.outcome === 'criticalSuccess' ? 'Critical success!' : 'Critical failure!',
        tone: effect.outcome === 'criticalSuccess' ? 'success' : 'danger'});
    }
    return result;
  }

  const api = Object.freeze({
    show,
    preview(sample = 'health') {
      if (sample === 'banner') return show({kind: 'banner', text: 'Combat Pulse preview', tone: 'neutral'});
      const canvas = getCanvas();
      const token = canvas?.tokens?.controlled?.find(value => tokenVisible(value, canvas.scene?.id));
      if (!token) return {shown: false, reason: 'select-token'};
      const samples = {
        health: {kind: 'health', hpDelta: -7, tempDelta: -3},
        healing: {kind: 'health', hpDelta: 5, tempDelta: 0},
        temp: {kind: 'health', hpDelta: 0, tempDelta: 4},
        check: {kind: 'check', total: 24, outcome: 'success', attack: false},
        critical: {kind: 'check', total: 30, outcome: 'criticalSuccess', attack: true}
      };
      return samples[sample] ? dispatch(samples[sample], token) : {shown: false, reason: 'invalid'};
    },
    clear: renderer.clear,
    diagnostics: () => Object.freeze({...renderer.diagnostics(), rememberedMessages: messages.size})
  });

  Hooks.once('init', () => registerSettings(game, () => { renderer.clear(); seedAll(); }));
  Hooks.once('ready', () => {
    game.modules.get(MODULE_ID).api = api;
    seedAll();
  });
  Hooks.on('canvasReady', seedAll);
  Hooks.on('canvasTearDown', () => { renderer.clear(); snapshots.clear(); });
  Hooks.on('createActor', seed);
  Hooks.on('deleteActor', actor => { snapshots.delete(actor); renderer.clear(); });
  Hooks.on('createToken', token => { if (token.actor) seed(token.actor); });
  Hooks.on('deleteToken', token => { if (token.actor?.isToken) snapshots.delete(token.actor); renderer.clear(); });
  Hooks.on('createChatMessage', message => {
    if (!canReadMessage(message, game.user) || !messages.add(message.uuid ?? message.id)) return;
    const effect = readMessage(message, game.system.id);
    if (!effect) return;
    const canvas = getCanvas();
    const speaker = message.speaker;
    const actorUuid = effect.actorUuid ?? (speaker?.scene && speaker.scene === canvas?.scene?.id
      ? canvas?.tokens?.placeables?.find(token => token.id === speaker.token)?.actor?.uuid : null)
      ?? game.actors?.get?.(speaker?.actor)?.uuid;
    dispatch(effect, resolveToken(actorUuid, speaker, canvas?.tokens?.placeables ?? [], canvas?.scene?.id));
  });
  Hooks.on('updateActor', (actor, _changed, options = {}) => {
    let effect = null;
    if (game.system.id === 'dnd5e') effect = dndHealth(actor, options);
    else if (generic()) {
      const prefs = preferences();
      effect = snapshots.update(actor, prefs.hpPath, prefs.tempPath);
    }
    if (!effect || (!game.user.isGM && !actor.isOwner)) return;
    const canvas = getCanvas();
    dispatch(effect, resolveToken(actor.uuid, null, canvas?.tokens?.placeables ?? [], canvas?.scene?.id));
  });
  return api;
}

if (globalThis.Hooks && globalThis.game) install({Hooks: globalThis.Hooks, game: globalThis.game,
  canvas: () => globalThis.canvas, PIXI: globalThis.PIXI});
