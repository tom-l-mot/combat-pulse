# Verify the first playable

Use disposable V14 worlds and a separate data folder dedicated to testing. Run the test server on an unused loopback port. Keep campaign worlds and other running servers separate.

Node checks cover normalized events and a fake rendering lifecycle. They do not prove GPU output or Foundry's multiplayer permissions. Record the Foundry and system versions, user roles, observed results, and remaining gaps. Keep raw logs, screenshots, and local world data outside source control.

## Reproduce CP-01 evidence

Use the fixture binding and exact generation commands in [Performance reports](performance.md). Run `live-qa.mjs emit` for actual system-method assertions. Run `benchmark.mjs emit` for one fixed workload. Both generated expressions return sanitized JSON and restore their own changes. Node never attaches to a browser. The checked-in synthetic fixture intentionally fails generation until copied and bound locally.

Run the ten lanes sequentially in an isolated world. Save `lane-1.png` through `lane-10.png` beside raw reports, install receipts, exact source SHAs, versions, and console error counts. A passing generated report only establishes its named workload and provenance. For lanes requiring controls, perform those actions through Foundry UI.

| Lane | Procedure and required evidence |
| --- | --- |
| 1 | Run the same `ten-hit` scene at trunk and head, then verify correct visible totals. Record absent trunk features explicitly. Keep the 0.1.0 reference separate. |
| 2 | Disable Combat Pulse in module management and reload. Run `off` with `system-ten-hit`. Save frame samples and a screenshot. |
| 3 | Run `burst100`. Verify 100 accepted calls and at most 32 active token effects. Capture visible burst output separately. |
| 4 | In PF2e, smoke-test working RPG Numbers through real system actions. Match numeric-only options and run `system-ten-hit` for all comparison variants. Record both versions and differences. Unsupported or broken comparisons are inconclusive. |
| 5 | Recreate the disposable world and fixture, then run system QA and the benchmark procedure again. Check that another run produces the same required evidence without campaign access. |
| 6 | Use GM and player clients for public, whispered, blind, and unowned-actor cases from Two-client privacy below. Record a separate receipt from each client for each case. |
| 7 | Through token controls, hide a source while feedback is active. Repeat with real detection-only visibility. Confirm numbers, banners, and token artwork disappear. Restore visibility afterward. |
| 8 | Change scenes, delete a fixture-owned temporary token, disable the module setting, and re-enable it. Verify idle cleanup after each step and a valid next event. Use disposable scene/token copies. Never delete and reconstruct an existing actor's token. |
| 9 | Use browser reduced-motion controls with the module setting off, then use the module's Reduce motion setting. Repeat visible previews and verify stationary readable text without shake or echoes. The browser control is separate evidence. |
| 10 | After a burst, call `clear`, inspect diagnostics, and inspect the browser console. Expect zero effects, zero owned layers, no module ticker, and no new uncaught error. Check expiry and idle results separately. |

For every UI observation, save a neutral receipt in this shape. Fill screenshot references only after capturing them. Do not include actor names, hidden values, message contents, rolls, entity IDs, or user IDs.

```json
{
  "schema": 1,
  "kind": "live-lane",
  "lane": 6,
  "runId": "privacy-public-1",
  "clientId": "gm-client",
  "actionProvenance": "ui-action",
  "status": "passed",
  "assertions": [{"id": "public-feedback-once", "status": "passed"}],
  "screenshotReferences": ["lane-6-gm-public.png"],
  "counterpartRunIds": ["privacy-public-1-player"]
}
```

Use `system-method` only for a verified system call, and `ui-action` only when Foundry controls were used. A two-client case requires distinct neutral run/client labels, matching case and installation receipts, and both screenshot references. Missing a client or screenshot leaves that case incomplete. Do not inspect excluded clients' hidden message fields to build a receipt. Record permitted effect counts and boolean assertions only.

Restore manual lane changes before the next lane. Browser crashes and interruption cannot guarantee restoration. Reset the disposable fixture, keep the incomplete report, and rerun. These procedures do not establish comparative speed, GPU-memory behavior, or complete multiplayer correctness until their real evidence exists.

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

The [verification record](verification.md) identifies the checks observed for this first playable. Basic runtime checks passed in PF2e, SF2e, and D&D5e. The checklist above is broader than those checks. Do not treat a basic pass as complete system acceptance. Generic live behavior and D&D5e check outcomes remain unverified.
