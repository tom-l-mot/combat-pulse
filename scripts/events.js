/** @typedef {'criticalSuccess'|'success'|'failure'|'criticalFailure'|'unknown'} Outcome */
/** @typedef {{kind:'health',tokenUuid:string,hpDelta:number,tempDelta:number}|{kind:'check',tokenUuid:string,total:number,outcome:Outcome,attack:boolean}|{kind:'banner',text:string,tone:'neutral'|'success'|'danger',tokenUuid?:string}} Effect */
const OUTCOMES = new Set(['criticalSuccess', 'success', 'failure', 'criticalFailure', 'unknown']);
const CHECKS = new Set(['attack-roll', 'saving-throw', 'skill-check', 'perception-check', 'initiative', 'flat-check', 'check']);
const HP = 'system.attributes.hp.value';
const TEMP = 'system.attributes.hp.temp';
export const finite = value => typeof value === 'number' && Number.isFinite(value);
export const getPath = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
export const validPath = path => typeof path === 'string' && /^system\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(path)
  && !path.split('.').some(key => ['__proto__', 'prototype', 'constructor'].includes(key));

export function normalizeEffect(value) {
  if (!value || typeof value !== 'object') return null;
  const tokenUuid = typeof value.tokenUuid === 'string' && value.tokenUuid.length <= 256 && value.tokenUuid.length > 0
    ? value.tokenUuid : null;
  if (value.kind === 'health' && tokenUuid && finite(value.hpDelta) && finite(value.tempDelta)
    && (value.hpDelta !== 0 || value.tempDelta !== 0)) {
    return {kind: 'health', tokenUuid, hpDelta: value.hpDelta, tempDelta: value.tempDelta};
  }
  if (value.kind === 'check' && tokenUuid && finite(value.total) && OUTCOMES.has(value.outcome)
    && (value.attack === undefined || typeof value.attack === 'boolean')) {
    return {kind: 'check', tokenUuid, total: value.total, outcome: value.outcome, attack: value.attack ?? false};
  }
  if (value.kind === 'banner' && typeof value.text === 'string' && value.text.trim().length > 0
    && value.text.length <= 160 && ['neutral', 'success', 'danger'].includes(value.tone)
    && (value.tokenUuid === undefined || tokenUuid)) {
    return {kind: 'banner', text: value.text.trim(), tone: value.tone, ...(tokenUuid ? {tokenUuid} : {})};
  }
  return null;
}

export function canReadMessage(message, user) {
  if (message.visible === false || message.isContentVisible !== true) return false;
  if (message.blind && !user.isGM) return false;
  const recipients = message.whisper ?? [];
  return user.isGM || recipients.length === 0 || recipients.some(recipient => (recipient.id ?? recipient) === user.id)
    || (!message.blind && (message.author?.id ?? message.user?.id) === user.id);
}

export function messageIdentitySet(capacity = 512) {
  const seen = new Set();
  return {
    add(id) {
      if (typeof id !== 'string' || !id || seen.has(id)) return false;
      seen.add(id);
      if (seen.size > capacity) seen.delete(seen.values().next().value);
      return true;
    },
    get size() { return seen.size; }
  };
}

export function readMessage(message, systemId, outcomesVisible = false) {
  if (systemId === 'pf2e' || systemId === 'sf2e') {
    const flags = message.flags?.[systemId];
    const applied = flags?.appliedDamage;
    if (applied) {
      if (applied.isReverted || typeof applied.uuid !== 'string' || !Array.isArray(applied.updates)) return null;
      let hpDelta = 0;
      let tempDelta = 0;
      for (const update of applied.updates) {
        if (!update || typeof update !== 'object') return null;
        if (![HP, TEMP].includes(update.path)) continue;
        if (!finite(update.value)) return null;
        if (update.path === HP) hpDelta -= update.value;
        else tempDelta -= update.value;
      }
      return hpDelta || tempDelta ? {kind: 'health', actorUuid: applied.uuid, hpDelta, tempDelta} : null;
    }
    const context = flags?.context;
    const total = message.rolls?.[0]?.total;
    if (!CHECKS.has(context?.type) || !finite(total)) return null;
    return {kind: 'check', total, outcome: outcomesVisible && OUTCOMES.has(context.outcome) ? context.outcome : 'unknown',
      attack: context.type === 'attack-roll'};
  }
  if (systemId === 'dnd5e') {
    const type = ['check', 'save', 'attack'].includes(message.type) ? message.type : message.flags?.dnd5e?.roll?.type;
    const total = message.rolls?.[0]?.total;
    if (!['check', 'attack', 'ability', 'skill', 'save', 'tool', 'death'].includes(type) || !finite(total)) return null;
    // shortcut: 5e outcome metadata is not runtime verified, keep outcomes unknown until fixtures prove it.
    return {kind: 'check', total, outcome: 'unknown', attack: type === 'attack'};
  }
  return null;
}

export function hpSnapshot(actor, hpPath = HP, tempPath = TEMP) {
  if (!validPath(hpPath) || (tempPath !== '' && !validPath(tempPath))) return null;
  const hp = getPath(actor, hpPath);
  const temp = tempPath === '' ? 0 : getPath(actor, tempPath);
  return finite(hp) && finite(temp) ? {hp, temp} : null;
}

export function healthDelta(previous, current) {
  if (!previous || !current || !finite(previous.hp) || !finite(previous.temp)) return null;
  const hpDelta = current.hp - previous.hp;
  const tempDelta = current.temp - previous.temp;
  return finite(hpDelta) && finite(tempDelta) && (hpDelta || tempDelta) ? {kind: 'health', hpDelta, tempDelta} : null;
}

export function dndHealth(actor, options) {
  if (options.isRest || options.isAdvancement) return null;
  const prior = options.dnd5e?.hp;
  return healthDelta(prior && {hp: prior.value, temp: prior.temp}, hpSnapshot(actor));
}

export function snapshotStore() {
  const snapshots = new Map();
  return {
    seed(actor, hpPath, tempPath) { snapshots.set(actor.uuid, hpSnapshot(actor, hpPath, tempPath)); },
    update(actor, hpPath, tempPath) {
      const previous = snapshots.get(actor.uuid);
      const current = hpSnapshot(actor, hpPath, tempPath);
      snapshots.set(actor.uuid, current);
      return healthDelta(previous, current);
    },
    delete(actor) { snapshots.delete(actor.uuid); },
    clear() { snapshots.clear(); }
  };
}

export function tokenVisible(token, sceneId) {
  return Boolean(token && !token.destroyed && !token.document?.hidden && !token.detectionFilter
    && token.document?.parent?.id === sceneId && token.visible === true);
}

export function resolveToken(actorUuid, speaker, tokens, sceneId) {
  const matches = tokens.filter(token => token.actor?.uuid === actorUuid && tokenVisible(token, sceneId));
  const spoken = matches.find(token => token.id === speaker?.token && speaker?.scene === sceneId);
  return spoken ?? (matches.length === 1 ? matches[0] : null);
}
