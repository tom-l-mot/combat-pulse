export const MODULE_ID = 'combat-pulse';
export const DEFINITIONS = Object.freeze([
  {key: 'enabled', name: 'Enable Combat Pulse', type: Boolean, default: true, scope: 'client'},
  {key: 'numbers', name: 'HP and temporary HP numbers', type: Boolean, default: true, scope: 'client'},
  {key: 'checks', name: 'Check totals and known outcomes', type: Boolean, default: true, scope: 'client'},
  {key: 'banners', name: 'Critical and custom banners', type: Boolean, default: true, scope: 'client'},
  {key: 'reactions', name: 'Token visual echoes', hint: 'Cosmetic echoes. Does not move tokens.', type: Boolean, default: false, scope: 'client'},
  {key: 'shake', name: 'Effect shake', hint: 'Moves only Combat Pulse effects.', type: Boolean, default: false, scope: 'client'},
  {key: 'reducedMotion', name: 'Reduce motion', hint: 'Browser reduced-motion preference also applies.', type: Boolean, default: false, scope: 'client'},
  {key: 'generic', name: 'Generic HP adapter', hint: 'Opt in only for other systems with exact numeric paths. These are resource changes, not proven damage.', type: Boolean, default: false, scope: 'world'},
  {key: 'hpPath', name: 'Generic HP path', type: String, default: 'system.attributes.hp.value', scope: 'world'},
  {key: 'tempPath', name: 'Generic temporary HP path', hint: 'Leave blank if the system has no temporary HP.', type: String, default: 'system.attributes.hp.temp', scope: 'world'}
]);

export function registerSettings(game, changed) {
  for (const definition of DEFINITIONS) {
    const {key, ...options} = definition;
    game.settings.register(MODULE_ID, key, {...options, config: true, onChange: changed});
  }
  const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;
  class PulsePreview extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {id: 'combat-pulse-preview', window: {title: 'Combat Pulse previews'},
      classes: ['combat-pulse'], position: {width: 360}, actions: {
        preview(_event, target) {
          const result = game.modules.get(MODULE_ID).api.preview(target.dataset.sample);
          if (!result.shown) ui.notifications.info(result.reason === 'select-token'
            ? 'Select a visible token to preview this effect.' : `Preview skipped (${result.reason}).`);
        },
        clear() { game.modules.get(MODULE_ID).api.clear(); }
      }};
    static PARTS = {body: {template: 'modules/combat-pulse/templates/settings.hbs'}};
  }
  game.settings.registerMenu(MODULE_ID, 'preview', {name: 'Preview Combat Pulse', label: 'Open previews',
    hint: 'Local previews use the selected visible token and your current settings.', icon: 'fas fa-burst', type: PulsePreview, restricted: false});
}

export function readPreferences(game, reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) {
  const result = Object.fromEntries(DEFINITIONS.map(({key}) => [key, game.settings.get(MODULE_ID, key)]));
  result.reducedMotion ||= reduced;
  return result;
}
