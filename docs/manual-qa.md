# Verify the first playable

Use disposable V14 worlds and a separate data folder dedicated to testing. Run the test server on an unused loopback port. Keep campaign worlds and other running servers separate.

Node checks cover normalized events and a fake rendering lifecycle. They do not prove GPU output or Foundry's multiplayer permissions. Mark a system runtime-verified only after its applicable checks pass. Record the Foundry and system versions, user roles, observed results, and remaining gaps outside source files.

## Preview and lifecycle

1. Enable the module and select one visible token. Open its previews from settings.
2. Run all six previews. Confirm separate HP and `Temp` labels, explicit check outcomes, and a critical banner.
3. Turn on visual echoes and effect shake. Confirm the actual token position, rotation, mesh, and camera do not change.
4. Enable reduced motion, then repeat. Confirm stationary fading text without echoes or shake. Also test browser reduced motion with the module setting off.
5. Pan and zoom while an effect runs. Confirm token alignment and readable text.
6. Hide or delete the source token during a critical preview. Confirm its number and banner disappear on the next frame.
   Repeat with a token that changes from ordinary vision to outline-only detection. Confirm all token effects disappear, and new effects cannot show the token artwork while detection-only.
7. Switch scenes and disable the module setting during effects. Confirm no owned layers or ticker remain.
8. Call `pulse.show` 100 times with a visible token. Confirm diagnostics never exceed 32 active effects and one banner. After expiry, expect `active: 0`, `banners: 0`, `ticking: false`, and `ownedLayers: 0`.

Here `pulse` means `game.modules.get('combat-pulse').api`. Its diagnostics are read-only snapshots. `frames` increases only while effects are active. These counters do not measure actual frame timing or prove a speedup.

## System events

1. In SF2e and PF2e, apply damage through system chat with both HP and temporary HP present. Confirm actual components, including overkill and capped healing.
2. Apply a shield-only change and create persistent damage without a tick. Confirm neither becomes HP loss. Apply a later persistent tick and confirm one effect.
3. Undo an applied-damage message. Confirm no second hit or fake healing.
4. Roll a check with a known explicit outcome and one with no outcome. Confirm no invented hit, miss, or critical.
5. In D&D5e, apply HP changes through the system, including HP loss plus equal temporary HP gain. Confirm both components. Confirm rest and advancement changes skip output. Roll ability checks, skills, saves, and attacks. Confirm numeric totals without inferred outcomes.
6. In another system, enable generic mode only after verifying its numeric paths. Confirm the first observation seeds without animation, max-only changes skip, and a real value change shows a resource delta.
7. Repeat with a synthetic unlinked actor and with two linked tokens. A matching speaker chooses one token. An ambiguous actor update skips.

## Two-client privacy

1. Connect a GM and a player. Produce a public check visible to both. Expect at most one effect per new message on each permitted client.
2. Send a private check to one recipient. Confirm excluded clients show no total, banner, echo, or shake.
3. Make a blind player-authored roll. Confirm the player author sees no result effect and the authorized GM can see it.
4. Apply actor-update HP changes to an actor the player does not own. Confirm no 5e or generic feedback on that client.
5. Hide a token or remove it from the active scene. Confirm neither client displays token effects for it.
6. Make two identical consecutive applications. Confirm both render. Reload or reopen chat history and confirm no replay.
7. In both PF2e and SF2e, disable Show Results and roll a public critical check. Confirm the player sees the total without an outcome label or critical banner, while the GM sees the outcome. Enable Show Results and confirm both clients see the outcome.

## Current release labels

Node checks use a fake Foundry runtime. SF2e HP and check field shapes have isolated-runtime evidence, but each release still needs recorded browser and multiplayer QA. Record PF2e, D&D5e, generic live behavior, GPU cleanup, and two-client checks as pending until observed. D&D5e check outcomes intentionally remain unknown.
