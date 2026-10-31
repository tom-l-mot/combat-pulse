import {DEFINITIONS} from '../scripts/settings.js';

class Point {
  constructor() { this.x = 0; this.y = 0; }
  set(x, y = x) { this.x = x; this.y = y; }
}
export class Container {
  constructor() {
    this.children = [];
    this.position = new Point();
    this.scale = new Point();
    this.anchor = new Point();
  }
  get x() { return this.position.x; }
  set x(value) { this.position.x = value; }
  get y() { return this.position.y; }
  set y(value) { this.position.y = value; }
  addChild(child) { this.children.push(child); child.parent = this; return child; }
  addChildAt(child, index) { this.children.splice(index, 0, child); child.parent = this; return child; }
  toLocal(point) { return {x: point.x / 2, y: point.y / 2}; }
  destroy(options) {
    this.destroyed = true;
    this.destroyOptions = options;
    if (options.children) for (const child of [...this.children]) child.destroy(options);
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
  }
}
class Text extends Container {
  constructor(text, style) { super(); this.text = text; this.style = style; }
}
class Sprite extends Container {
  constructor(texture) { super(); this.texture = texture; }
}
class Graphics extends Container {
  lineStyle() { return this; }
  moveTo() { return this; }
  lineTo() { return this; }
}
export const PIXI = {Container, Text, Sprite, Graphics};

export function runtime(systemId = 'sf2e') {
  const handlers = new Map();
  const Hooks = {
    on(name, callback) { const list = handlers.get(name) ?? []; list.push(callback); handlers.set(name, list); },
    once(name, callback) {
      const once = (...args) => {
        const list = handlers.get(name);
        list.splice(list.indexOf(once), 1);
        callback(...args);
      };
      this.on(name, once);
    },
    call(name, ...args) { for (const handler of [...handlers.get(name) ?? []]) handler(...args); }
  };
  const actor = {uuid: 'Actor.a', id: 'a', isOwner: true, system: {attributes: {hp: {value: 40, temp: 8}}}};
  const token = {id: 't', document: {uuid: 'Scene.s.Token.t', parent: {id: 's'}, hidden: false},
    actor, visible: true, center: {x: 200, y: 300}, w: 100, h: 100, mesh: {texture: {shared: true}}};
  const callbacks = new Set();
  const canvas = {ready: true, scene: {id: 's'}, interface: new Container(), stage: {scale: {x: 1}},
    tokens: {placeables: [token], controlled: [token]},
    app: {renderer: {screen: {width: 1200, height: 800}}, ticker: {
      add(callback) { callbacks.add(callback); }, remove(callback) { callbacks.delete(callback); }
    }}};
  const values = Object.fromEntries(DEFINITIONS.map(({key, default: value}) => [key, value]));
  const registrations = new Map();
  const menus = new Map();
  const modules = new Map([['combat-pulse', {}]]);
  const actors = new Map([['a', actor]]);
  actors[Symbol.iterator] = function* () { yield* this.values(); };
  const game = {system: {id: systemId}, user: {id: 'u', isGM: false}, modules, actors,
    pf2e: {settings: {metagame: {results: true}}},
    settings: {get: (_id, key) => values[key],
      register: (_id, key, options) => registrations.set(key, options),
      registerMenu: (_id, key, options) => menus.set(key, options)}};
  let clock = 0;
  return {Hooks, game, canvas, token, actor, values, callbacks, PIXI, handlers, registrations, menus,
    now: () => clock,
    advance(ms) { clock += ms; for (const callback of [...callbacks]) callback(); },
    message(id = 'm', flags = {sf2e: {appliedDamage: {uuid: 'Actor.a', updates: [
      {path: 'system.attributes.hp.temp', value: 8}, {path: 'system.attributes.hp.value', value: 2}
    ]}}}) {
      return {id, uuid: `ChatMessage.${id}`, visible: true, isContentVisible: true, blind: false, whisper: [],
        flags, speaker: {scene: 's', token: 't', actor: 'a'}, rolls: [{total: 24}]};
    }
  };
}
