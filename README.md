# Combat Pulse

Combat feedback for Foundry Virtual Tabletop V14. Combat Pulse shows applied HP and temporary HP changes, check totals and known outcomes, critical banners, optional token visual echoes, and effect shake.

This first playable has no runtime dependencies.

## Install and preview

1. Run `npm run package` on Windows with Node 22 or later and Windows `tar.exe` available.
2. Extract `dist/combat-pulse.zip` into the `Data/modules` folder of an isolated Foundry V14 installation. The resulting path is `Data/modules/combat-pulse/module.json`.
3. Enable Combat Pulse in the test world.
4. Open **Configure Settings**, then **Combat Pulse**. Select a visible token and open **Preview Combat Pulse**.

Public preview installer manifest: https://github.com/tom-l-mot/combat-pulse/releases/download/v0.1.0-preview.1/module.json

Paste this URL into Foundry's Install Module manifest field. Source and releases are hosted together in this repository. This remains an early testing preview.

## System support

| System | Automatic HP feedback | Checks | Status |
| --- | --- | --- | --- |
| PF2e 8.6.1 | Applied-damage chat flags | Explicit totals and outcomes | Basic damage, capped healing, checks, and preview controls passed in an isolated V14 world. |
| SF2e 1.6.1 | Exact SF2e applied-damage namespace | Explicit totals and outcomes | Basic events and two-client hidden-outcome checks passed in an isolated V14 world. |
| D&D5e 6.0.6 | Prior HP from actor update options and current HP | Current check, save, and attack message totals, plus legacy roll flags. Outcomes stay unknown. | Basic events, two-client privacy, effect limits, and cleanup passed. Save and attack types remain source-grounded. |
| Other systems | Opt-in numeric HP and optional temporary HP paths | Local API only | Limited generic mode. System-specific combat meaning is not inferred. |

The manifest does not restrict systems. That does not promise automatic integration with every system. Generic mode is off by default and does not run alongside PF2e, SF2e, or D&D5e HP adapters. PF-family direct sheet HP edits are outside its applied-chat path. D&D5e and Foundry may show their own numbers at the same time. Combat Pulse never changes their settings.

## Privacy and motion

Every client derives permitted effects locally. Combat Pulse sends no socket messages. Hidden content and blind player rolls cannot generate numbers or critical banners. PF2e and SF2e players see outcomes only when Show Results is enabled. Token effects require one unambiguous visible token in the current scene. Actor-update feedback requires GM or actor ownership. Hidden and detection-only tokens are skipped even for the GM.

Token reactions are cosmetic texture echoes. Effect shake moves the effects only. They do not move actual tokens or the camera. Reduced motion follows the browser preference or the client setting and leaves stationary fading text. There is no automatic sound.

Combat Pulse preserves the broad feedback groups, not the full RPG Numbers catalog. Actual token rotation, camera shake, finishers, stress presets, and cinematic assets are outside this first version. No measured performance superiority is claimed.

## Local macro API

```js
const pulse = game.modules.get('combat-pulse').api;
pulse.show({kind: 'health', tokenUuid: token.document.uuid, hpDelta: -7, tempDelta: -3});
pulse.show({kind: 'check', tokenUuid: token.document.uuid, total: 24, outcome: 'success', attack: true});
pulse.show({kind: 'banner', text: 'Round two', tone: 'neutral'});
pulse.preview('critical');
pulse.clear();
pulse.diagnostics();
```

Calls affect this client only. Token effects still require visibility. `show` and `preview` return `{shown: true}` or `{shown: false, reason}`. Reasons are `invalid`, `disabled`, `no-canvas`, `not-visible`, or `select-token`. Banner text is plain text, limited to 160 characters. Tones are `neutral`, `success`, and `danger`. Check outcomes are `criticalSuccess`, `success`, `failure`, `criticalFailure`, and `unknown`.

Preview samples are `health`, `healing`, `temp`, `check`, `critical`, and `banner`. Previews respect settings and never change documents or create chat. `diagnostics()` returns an immutable snapshot of counts. It exposes no renderer, tokens, rolls, or mutable state.

## Verify

Run `npm test`, `npm run check`, and `npm run package`. No npm installation is needed. Windows CI runs these same checks and retains the installable archive. Packaging verifies archive paths and extracted file bytes against the source.

See [Architecture](docs/architecture.md) for ownership, [Manual QA](docs/manual-qa.md) for runtime acceptance, and [Verification record](docs/verification.md) for observed results and remaining gaps. Passing Node tests alone does not establish browser or multiplayer support.
