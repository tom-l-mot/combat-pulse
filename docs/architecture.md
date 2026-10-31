# Architecture

Combat Pulse owns a local PIXI container under `canvas.interface`. It never modifies actor documents, token meshes, the camera, or core scrolling-text settings. A single ticker callback exists only while effects are active. New effects evict the oldest at 32 token effects. One banner replaces the previous banner. There is no queue.

## Ownership

| File | Responsibility |
| --- | --- |
| `scripts/events.js` | Validated effect union, exact system namespaces, message authorization, bounded message identities, numeric HP snapshots, and token resolution. |
| `scripts/main.js` | Hooks, single HP source selection, local API, snapshot lifecycle, and dispatch. |
| `scripts/render.js` | All PIXI resources, animation, visibility cancellation, effect limits, and ticker cleanup. |
| `scripts/settings.js` | One settings definition list, registration, client preferences, and preview application. |

Health effects contain signed `hpDelta` and `tempDelta` separately. Temporary HP gains always carry a `Temp` label. Check effects contain a numeric total and an explicit outcome enum. Unknown outcomes remain unknown. Banners contain bounded plain text and a preset tone. Optional banner token UUIDs keep critical banners attached to the source's visibility authorization.

## Event path

Chat authorization runs before flags or rolls are read. New message identities enter a 512-entry insertion-ordered set before dispatch. Each message UUID is processed once while remembered. Distinct identical applications remain distinct. No history or render-message hook is replayed. A module reload resets the bounded identity set, but it does not replay old messages.

PF2e and SF2e use only `createChatMessage` for HP. The active system ID selects its exact flag namespace. Applied updates store old minus new; normalization negates whitelisted HP and temporary HP paths. Shield-only changes, persistent-condition creation, and reverted applications emit no HP effect. Updating a message to undo damage does not create another animation.

D&D5e uses one `updateActor` handler for HP. `options.dnd5e.hp` supplies the previous values. Rest and advancement updates skip output. Both components survive zero-sum changes. There are no apply-damage or heal/damage hooks that could duplicate that handler. Actor updates have no guessed amount or time deduplication.

Generic mode stores actor UUID snapshots, including synthetic actors. Ready, canvas ready, actor creation, and token creation seed snapshots. Every actor update refreshes its snapshot before ownership or visibility filtering. Missing or nonfinite observations do not produce deltas. Removing actors or synthetic tokens removes their snapshots. Paths must be explicit safe `system.*` paths with exact numeric values. The optional temporary HP path can be empty.

Speaker tokens are accepted only when they match the application actor. Otherwise exactly one currently visible matching token is required. Multiple linked tokens without a matching speaker are ambiguous and skipped.

## Lifecycle

Active token effects follow token centers and canvas zoom. Visibility, scene membership, and hidden status are checked every active frame, including for derived critical banners. Clear, scene teardown, token deletion, actor deletion, disable, expiry, and eviction destroy owned display objects and remove idle callbacks. Settings changes clear current effects and reseed snapshots.

Text and geometry belong to the module. Echo sprites borrow token textures and destroy neither their textures nor base textures. Reduced motion disables displacement, shake, and echoes. Text remains static relative to its token while it fades. Diagnostics expose only immutable counters, including current active effects, banner count, ticker state, frames processed, displayed effects, evictions, owned layers, and remembered messages.

The renderer uses Foundry's bundled PIXI 7 API. Unit tests exercise a fake hook, ticker, scene, and PIXI runtime. Real rendering, occlusion, session privacy, and hook payloads still require the manual checks.
