import {tokenVisible} from './events.js';

const COLORS = {loss: 0xff667a, gain: 0x65e6a2, temp: 0x74c9ff, neutral: 0xffefc1, success: 0x65e6a2, danger: 0xff667a};
const LABELS = {criticalSuccess: 'Critical success', success: 'Success', failure: 'Failure', criticalFailure: 'Critical failure', unknown: ''};
const signed = value => `${value > 0 ? '+' : ''}${value}`;

export function effectText(effect) {
  if (effect.kind === 'banner') return effect.text;
  if (effect.kind === 'check') return `${effect.total}${LABELS[effect.outcome] ? `\n${LABELS[effect.outcome]}` : ''}`;
  return [effect.hpDelta ? signed(effect.hpDelta) : '', effect.tempDelta ? `Temp ${signed(effect.tempDelta)}` : ''].filter(Boolean).join('\n');
}

/** Owns only its container and display objects. No token mesh or shared texture mutation. */
export function createRenderer({canvas: getCanvas, token: getToken, preferences, PIXI, now = () => performance.now()}) {
  let layer = null;
  let ticker = null;
  const active = [];
  let banner = null;
  let displayed = 0;
  let evicted = 0;
  let frames = 0;

  function destroy(record) {
    record.text.destroy({texture: true, baseTexture: true});
    record.node.destroy({children: true, texture: false, baseTexture: false});
  }

  function stopIfIdle() {
    if (active.length || banner) return;
    if (ticker) ticker.remove(tick);
    ticker = null;
    if (layer) layer.destroy({children: true, texture: false, baseTexture: false});
    layer = null;
  }

  function clear() {
    for (const record of active) destroy(record);
    active.length = 0;
    if (banner) destroy(banner);
    banner = null;
    stopIfIdle();
  }

  function position(record, progress, prefs) {
    const canvas = getCanvas();
    const token = record.effect.tokenUuid ? getToken(record.effect.tokenUuid) : null;
    if (record.effect.tokenUuid && !tokenVisible(token, canvas.scene?.id)) return false;
    const scale = Math.max(0.4, Math.min(3, 1 / (canvas.stage.scale.x || 1)));
    const isBanner = record.effect.kind === 'banner';
    const screen = canvas.app.renderer.screen;
    const center = isBanner ? layer.toLocal({x: screen.width / 2, y: screen.height * 0.22}) : token.center;
    const motion = !prefs.reducedMotion;
    record.node.position.set(center.x, center.y - (!isBanner ? token.h / 2 : 0) - (motion ? progress * 65 * scale : 0));
    record.node.scale.set(scale);
    record.node.alpha = Math.min(1, (1 - progress) * 3);
    if (record.echo) {
      record.echo.alpha = (1 - progress) * 0.2;
      record.echo.position.set(0, token.h / (2 * scale));
      record.echo.width = token.w / scale;
      record.echo.height = token.h / scale;
      record.echo.x += motion ? Math.sin(progress * Math.PI) * 16 : 0;
      record.echo.visible = motion && prefs.reactions;
    }
    if (motion && prefs.shake && record.impact && progress < 0.25) {
      record.node.x += Math.sin(progress * 90) * 4 * scale;
    }
    return true;
  }

  function tick() {
    frames++;
    const prefs = preferences();
    if (!prefs.enabled) return clear();
    for (let i = active.length - 1; i >= 0; i--) {
      const record = active[i];
      const progress = (now() - record.started) / record.duration;
      const allowed = record.effect.kind === 'health' ? prefs.numbers : prefs.checks;
      if (!allowed || progress >= 1 || !position(record, progress, prefs)) {
        active.splice(i, 1);
        destroy(record);
      }
    }
    if (banner) {
      const progress = (now() - banner.started) / banner.duration;
      if (!prefs.banners || progress >= 1 || !position(banner, progress, prefs)) {
        destroy(banner);
        banner = null;
      }
    }
    stopIfIdle();
  }

  function show(effect) {
    const canvas = getCanvas();
    if (!canvas?.ready || !canvas.interface || !canvas.app?.ticker) return {shown: false, reason: 'no-canvas'};
    const prefs = preferences();
    if (!prefs.enabled || (effect.kind === 'health' && !prefs.numbers) || (effect.kind === 'check' && !prefs.checks)
      || (effect.kind === 'banner' && !prefs.banners)) return {shown: false, reason: 'disabled'};
    const token = effect.tokenUuid ? getToken(effect.tokenUuid) : null;
    if (effect.tokenUuid && !tokenVisible(token, canvas.scene?.id)) return {shown: false, reason: 'not-visible'};
    if (!layer) {
      layer = new PIXI.Container();
      layer.eventMode = 'none';
      canvas.interface.addChild(layer);
    }
    const node = new PIXI.Container();
    const color = effect.kind === 'health' ? (effect.hpDelta ? (effect.hpDelta < 0 ? COLORS.loss : COLORS.gain) : COLORS.temp)
      : effect.kind === 'banner' ? COLORS[effect.tone] : COLORS.neutral;
    const text = new PIXI.Text(effectText(effect), {fontFamily: 'sans-serif', fontSize: effect.kind === 'banner' ? 36 : 28,
      fontWeight: 'bold', fill: color, stroke: 0x171722, strokeThickness: 5, align: 'center', lineJoin: 'round',
      wordWrap: effect.kind === 'banner', wordWrapWidth: Math.min(600, canvas.app.renderer.screen.width * 0.8), breakWords: true});
    text.anchor.set(0.5, 1);
    if (effect.kind === 'banner') {
      const accent = new PIXI.Graphics();
      accent.lineStyle({width: 3, color, alpha: 0.8}).moveTo(-100, 8).lineTo(100, 8);
      node.addChild(accent);
    }
    node.addChild(text);
    const record = {effect, node, text, started: now(), duration: effect.kind === 'banner' ? 1800 : 1250,
      impact: effect.kind === 'health' && (effect.hpDelta < 0 || effect.tempDelta < 0)};
    if (prefs.reactions && !prefs.reducedMotion && token?.mesh?.texture && effect.kind !== 'banner') {
      const echo = new PIXI.Sprite(token.mesh.texture);
      echo.anchor.set(0.5);
      echo.tint = color;
      node.addChildAt(echo, 0);
      record.echo = echo;
    }
    layer.addChild(node);
    if (effect.kind === 'banner') {
      if (banner) destroy(banner);
      banner = record;
    } else {
      if (active.length === 32) {
        destroy(active.shift());
        evicted++;
      }
      active.push(record);
    }
    position(record, 0, prefs);
    displayed++;
    if (!ticker) {
      ticker = canvas.app.ticker;
      ticker.add(tick);
    }
    return {shown: true};
  }

  return {show, clear, diagnostics: () => Object.freeze({active: active.length, banners: banner ? 1 : 0,
    ticking: Boolean(ticker), displayed, evicted, frames, ownedLayers: layer ? 1 : 0})};
}
