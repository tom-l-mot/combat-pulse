# Reproduce QA and performance reports

Use an isolated Foundry V14 world with disposable data. These Node tools print self-contained browser expressions. They never attach to a browser, start a server, install packages, or read credentials. Evaluate the expression in the selected test client's console or through an authorized browser driver. Save the returned object as JSON outside source control.

## Bind the disposable fixture

1. Copy `tests/fixtures/qa-example.json` to a local file outside Git.
2. Replace the world, scene, actor, and token IDs with exact local bindings. Use one visible, owned token and an actor with maximum HP of 40. The tool rejects ambiguous linked tokens, hidden tokens, detection-only tokens, and background clients.
3. Set `synthetic` to `false` only after checking those bindings. The checked-in example is deliberately rejected. The tool also rejects placeholder IDs and zero installation hashes.
4. Record the installed package's SHA-256, source commit, dirty state, and a neutral installation receipt label. Keep the actual installation evidence beside the report. A module version is not a source SHA. For comparisons, package a clean commit and verify the installed bytes before each reload.
5. Fill in CPU, RAM, GPU, OS, and browser version. Use neutral machine, fixture, run, and client labels. The browser supplies its user agent, viewport, pixel ratio, PIXI version, renderer dimensions, active modules, scene dimensions, grid size, token dimensions, token count, and zoom.
6. Set the seven client preferences explicitly. Use a distinct `runId` for each run. Keep the other labels and machine metadata stable across a comparison.

The pinned system methods are PF2e 8.6.1, SF2e 1.6.1, and D&D5e 6.0.6. Different versions fail preflight. Verify their actual APIs before extending this allowlist. No licensed system source or world export belongs in the repository.

Local fixture files and emitted expressions contain private bindings. Reports omit entity and user IDs, names, raw chats, rolls, and exception messages. Keep operator-supplied labels and receipt fields neutral. The tools allowlist reported installation and machine fields, but cannot redact a private name that an operator puts into an intended metadata value.

## Run system correctness checks

From the checkout, generate the expression with Node 22 or later. In PowerShell, use UTF-8 output.

```powershell
node tools/live-qa.mjs emit --fixture=C:/local/qa-fixture.json | Set-Content -Encoding utf8 C:/local/qa-browser.js
```

Evaluate the generated expression in the disposable client. Expect a `system-qa` report with three passed assertions and three completed actions. The script seeds 40 HP and 8 temporary HP, applies 10 damage through the system, heals by 5, and rolls a real check. It checks separate damage components, capped healing, and a displayed numeric check total.

The script records `system-method` provenance. It does not satisfy sheet-control, privacy, or two-client lanes. Attach the required UI receipts in [Manual QA](manual-qa.md). Empty screenshot and counterpart lists are evidence still to collect, not a visual pass.

The script restores original HP, temporary HP, pause state, and each changed client preference in independent `finally` attempts. It clears effects before and after restoration. Primary failures and cleanup failures survive separately. Generated chat messages remain in the disposable world. The script never deletes chat history. If the tab crashes or the process stops, `finally` cannot run. Reset the disposable fixture and discard that sample before continuing.

## Run fixed benchmark workloads

Install and reload the selected revision before emitting each run. Installation and the 250 ms preference-settling period occur outside the measurement window. The workload owns its fixture and must run alone on that client.

```powershell
node tools/benchmark.mjs emit --fixture=C:/local/qa-fixture.json --variant=baseline --pair=1 --workload=ten-hit | Set-Content -Encoding utf8 C:/local/benchmark-browser.js
```

Evaluate the expression and save its returned `benchmark` report. Repeat with the required variant, pair, and unique run label. Supported variants are `baseline`, `head`, `current`, `off`, and `rpg-numbers`. Pair numbers are 1 through 5.

| Workload | Completed work | Cadence | Eligible variants |
| --- | --- | --- | --- |
| `ten-hit` | Ten accepted local `api.show` health effects | 250 ms after each call except the last | baseline, head, current |
| `burst100` | 100 accepted local `api.show` health effects | Synchronous burst | baseline, head, current |
| `system-ten-hit` | Ten actual one-point system damage applications, each verified by HP plus temporary HP loss | 250 ms after each method resolves except the last | All variants |

The API workloads bypass system adapters and chat authorization. They are renderer evidence. Never compare them against module-off or RPG Numbers. The system workload seeds 40 HP and zero temporary HP outside the window, then checks each real application. Every hit reduces HP, so a comparator that displays only HP changes receives ten numeric-display opportunities. Use the same system workload for every variant in that cohort. The separate system correctness check retains 8 temporary HP to verify both damage components.

For `off`, disable Combat Pulse in module management and reload. Turning off its client setting does not produce a module-off installation. For RPG Numbers, disable Combat Pulse, enable the working PF2e comparator, and reload. Add a local `comparator` object containing `moduleId`, exact `version`, `smokeVerified: true`, and a neutral `settingsReceipt`. First verify visible output through the actual system method. Record equivalent numeric-only options and the screenshot in that receipt. This flag records the operator's evidence, not an automated comparator smoke test. Missing or broken comparator support is inconclusive. Do not substitute an API effect for a real system action.

## Compare five interleaved pairs

1. Freeze the reference machine, scene, token, viewport, zoom, browser, motion preferences, and other modules. Close unrelated profiling tools. Keep the client visible.
2. Run this chronological sequence, with a verified install and reload between revisions: pair 1 baseline then head, pair 2 head then baseline, pair 3 baseline then head, pair 4 head then baseline, pair 5 baseline then head.
3. Save every raw report. Retain failed runs as failure evidence and repeat the entire affected pair after correcting the cause. Never select the fastest samples.
4. Create `reports.json` as a JSON array containing the ten report objects. The file contains objects, not filenames. No scheduling or browser control occurs in the reducer.
5. Run the comparison command.

```powershell
node tools/benchmark.mjs compare --reports=C:/local/reports.json | Set-Content -Encoding utf8 C:/local/comparison.json
```

The reducer validates actual chronology, alternating order, unique runs, full metadata, clean and consistent installations, matched work, raw samples, counters, errors, and successful restoration. It rejects unequal scene geometry, module versions, settings, hardware, measurement modes, or missing metrics in only part of the cohort. Installation identity can differ between baseline and head, but stays fixed within each variant. A comparison uses distinct source commits. Record the 0.1.0 reference separately from trunk.

Successful output is `comparable`. Invalid evidence returns `inconclusive` and a reason code, with exit code 1 and no timing summaries. The reducer summarizes baseline/head cohorts only. Module-off and RPG Numbers remain separate observation reports for manual matched-system analysis. Five pairs alone do not establish statistical confidence.

## Interpret the measurements

`dispatchMs` contains one raw duration per completed call. For an API workload this is synchronous dispatch and allocation time. For a system workload it includes the awaited system method. Do not mix those meanings across cohorts.

`frameTimestampsMs` and `frameIntervalsMs` come from `requestAnimationFrame` over the whole collection window, including workload, a 2000 ms expiry wait, and a 250 ms idle wait. They describe whole-client frame cadence during that window. They do not isolate active-frame CPU cost. Window start and finish use the same performance clock. Quantiles use nearest rank: sort the samples and select index `ceil(fraction * count) - 1`. Pair summaries and pooled summaries retain sample counts.

`dispatchToRenderCompleteMs` observes the installed PIXI renderer's `runners.postrender`. It records a render-complete boundary only while a newly submitted effect remains active. A synchronous burst contributes one boundary, while paced calls can contribute one each. A rejected run cannot produce comparable results. Unsupported or unobserved boundaries are unavailable. Actual system actions do not claim an isolated render-complete measurement.

Render completion is not visible-pixel latency or compositor presentation. A screenshot proves visible output at capture time, not an exact latency. True first-visible latency needs separate presentation evidence. The module callback is private, so callback CPU attribution remains unavailable until independent installed-client validation supports a narrowly restored probe. This implementation does not patch ticker methods.

Diagnostics record before, after submission, after expiry, and after final clear. Display and eviction counts are differences, since `clear` does not reset cumulative counters. Reports retain attempted, completed, accepted, and rejected work. Failed actions stay in the denominator. Active effects stay at most 32 and banners at most one. An unchanged idle diagnostic frame count is lifecycle evidence, not an independently attributed callback measurement.

Browser errors and unhandled rejections produce safe codes rather than private payloads. These listeners cover the run, not errors that happened before it. Inspect the browser console separately. Metadata is checked again before cleanup. Resource counters establish owned-layer cleanup. They do not measure GPU memory. Heap sampling, GPU memory, module callback CPU, and presentation latency remain explicitly unavailable.

The proposed 2 ms active-frame, 100 ms first-visible, and comparative frame-time budgets remain uncalibrated. Do not freeze or pass them using scheduling proxies, fake-runtime tests, or ownership counters. Keep unmatched workloads and unavailable metrics inconclusive.
