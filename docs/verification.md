# First playable verification record

These results cover the first playable on Foundry 14.369 in disposable local worlds. Runtime source is unchanged from commit `2ed4578563e6716aeb889d065438ffddb145fbe0`. The browser was Brave. A separate server used a loopback port and its own worlds and system package copies.

## Observed system behavior

| System | Checks passed |
| --- | --- |
| PF2e 8.6.1 | Actual 10 damage against 40 HP and 8 temporary HP produced one `-2` and `Temp -8` effect. Healing by 5 at 38 of 40 HP displayed `+2`. An actual attack check displayed its total and explicit outcome. All six preview controls dispatched effects. |
| SF2e 1.6.1 | The same damage, capped-healing, and actual attack-check assertions passed. With Show Results disabled, a public critical fixture displayed a numeric total to the player and no outcome or banner. The GM saw the critical label and banner. |
| D&D5e 6.0.6 | Actual damage and capped healing displayed their components. A loss of 5 HP combined with a gain of 5 temporary HP displayed both. An actual ability check displayed its numeric total. Two clients received one effect each for a public check. An excluded player received none for an explicitly whispered check, a blind player-authored check, or an unowned actor HP update. |

The SF2e privacy fixture cloned an actual check document and set its explicit outcome to critical success. It verifies the visibility boundary with controlled metadata. It is not a natural-die critical test. The D&D5e private fixture used explicit whisper recipients after a roll configuration attempt produced a public message.

## Renderer checks

The live D&D5e client accepted 100 effects, kept at most 32 token effects, and evicted 68. After expiry and a real canvas ticker callback, diagnostics reported zero effects, zero banners, zero owned layers, and no module ticker. The frame counter stayed unchanged while idle.

Reduced-motion text stayed stationary relative to its token. Clearing the effect destroyed its generated text texture while preserving the borrowed token texture. This checks resource ownership. It is not a GPU-memory measurement. A canvas image also confirmed visible number and critical-banner output in PF2e.

## Local checks

`npm test` passed all 26 tests. The tests cover normalization, authorization, generic snapshots, exact system namespaces, startup binding, token resolution, effect caps, and cleanup in a fake runtime. `npm run check` passed JavaScript syntax and manifest-reference checks. `npm run package` verified the archive paths and extracted bytes against source files.

An independent source review found the initial startup and privacy faults before acceptance. Those faults were fixed with regressions. A later review of the corrected source found no additional actionable defect. This is not a guarantee that the module has no bugs.

## Remaining gaps

- Generic HP mode has Node coverage but no live test in another system.
- PF2e and SF2e shield, persistent damage, undo, synthetic actors, and multiple linked tokens have source or fixture coverage, not a complete live matrix.
- Live PF2e two-client outcome hiding and real outline-only detection remain untested. Shared guards have Node regressions, and SF2e outcome hiding has two-client evidence.
- D&D5e save and attack message types are source-grounded. Automatic outcomes remain unknown.
- Browser-level reduced-motion preference, camera motion, pan and zoom, and every scene-transition path still need broader manual QA.
- No comparison against RPG Numbers, frame-time benchmark, campaign-load test, or long-session memory study has run.
- At the local verification checkpoint, remote CI and a hosted PR bot had not run. Check the pull request for later results. No release or public manifest installer URL is published.
