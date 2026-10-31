import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {browserContext, cliOptions, validateFixture} from './live-qa.mjs';

export function validateRequest(variant, pair, workload) {
  if (!['baseline', 'head', 'current', 'off', 'rpg-numbers'].includes(variant)
    || !Number.isInteger(pair) || pair < 1 || pair > 5
    || !['ten-hit', 'burst100', 'system-ten-hit'].includes(workload)
    || (['off', 'rpg-numbers'].includes(variant) && workload !== 'system-ten-hit')) throw new Error('invalid-workload');
}

export async function runBrowserBenchmark(fixture, variant, pair, workload, context = browserContext) {
  const count = workload === 'burst100' ? 100 : 10;
  const cadence = workload === 'burst100' ? 0 : 250;
  const report = {schema: 1, kind: 'benchmark', variant, pair, status: 'failed',
    actionProvenance: workload === 'system-ten-hit' ? 'system-method' : 'renderer-api',
    startedAt: new Date().toISOString(),
    samples: {dispatchMs: [], frameIntervalsMs: [], frameTimestampsMs: [], dispatchToRenderCompleteMs: []},
    work: {attempted: 0, completed: 0, accepted: 0, rejected: 0, displayed: null, evicted: null, maxActive: 0, maxBanners: 0},
    resources: {}, errors: {count: 0, codes: []}, cleanup: {status: 'not-needed', failedSteps: []},
    unavailable: [
      {metric: 'moduleCallbackMs', reasonCode: 'attribution-unverified'},
      {metric: 'presentationLatencyMs', reasonCode: 'presentation-not-observed'},
      {metric: 'gpuMemory', reasonCode: 'unsupported'},
      {metric: 'heap', reasonCode: 'not-collected'}
    ]};
  let owner, raf, observer, runner, stopFrames = false;
  const now = () => performance.now();
  try {
    validateFixture(fixture);
    validateRequest(variant, pair, workload);
    owner = context(fixture, variant);
    report.errors = owner.errors;
    await owner.prepare();
    if (workload === 'system-ten-hit') await owner.seed(0);
    report.metadata = owner.metadata(workload, cadence);
    report.resources.before = owner.snapshot();
    let lastFrame;
    const frame = timestamp => {
      if (stopFrames) return;
      report.samples.frameTimestampsMs.push(timestamp);
      if (lastFrame !== undefined) report.samples.frameIntervalsMs.push(timestamp - lastFrame);
      lastFrame = timestamp;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    runner = canvas.app.renderer.runners?.postrender;
    let pendingDispatch;
    if (workload !== 'system-ten-hit' && runner?.add && runner?.remove) {
      observer = {postrender() {
        if (pendingDispatch !== undefined && owner.snapshot().active > 0) {
          report.samples.dispatchToRenderCompleteMs.push(now() - pendingDispatch);
          pendingDispatch = undefined;
        }
      }};
      runner.add(observer);
    } else report.unavailable.push({metric: 'dispatchToRenderCompleteMs', reasonCode: workload === 'system-ten-hit' ? 'system-boundary-not-isolated' : 'postrender-unavailable'});
    report.windowStartedMs = now();
    for (let index = 0; index < count; index++) {
      owner.require(document.visibilityState === 'visible' && canvas.scene.id === fixture.sceneId, 'fixture-changed');
      const start = now();
      if (observer && pendingDispatch === undefined) pendingDispatch = start;
      report.work.attempted++;
      if (workload === 'system-ten-hit') {
        const hp = owner.actor.system.attributes.hp;
        const previous = hp.value + hp.temp;
        await owner.damage(1);
        const current = owner.actor.system.attributes.hp;
        owner.require(previous - current.value - current.temp === 1, 'system-work-mismatch');
        report.work.accepted++;
      } else {
        const result = owner.pulse.show({kind: 'health', tokenUuid: owner.token.document.uuid, hpDelta: -1, tempDelta: 0});
        if (result?.shown === true) report.work.accepted++;
        else report.work.rejected++;
      }
      report.samples.dispatchMs.push(now() - start);
      report.work.completed++;
      const state = owner.snapshot();
      report.work.maxActive = Math.max(report.work.maxActive, state?.active ?? 0);
      report.work.maxBanners = Math.max(report.work.maxBanners, state?.banners ?? 0);
      if (index < count - 1 && cadence) await owner.delay(cadence);
    }
    report.resources.afterBurst = owner.snapshot();
    await owner.delay(2000);
    report.resources.afterExpiry = owner.snapshot();
    const idleFrames = owner.snapshot()?.frames;
    await owner.delay(250);
    report.idleDiagnosticFrames = owner.snapshot() ? owner.snapshot().frames - idleFrames : null;
    report.windowFinishedMs = now();
    owner.require(document.visibilityState === 'visible' && canvas.scene.id === fixture.sceneId
      && JSON.stringify(owner.metadata(workload, cadence)) === JSON.stringify(report.metadata), 'metadata-changed');
    stopFrames = true;
    cancelAnimationFrame(raf);
    if (observer) { runner.remove(observer); observer = null; }
    const before = report.resources.before;
    const after = report.resources.afterExpiry;
    if (before && after) {
      report.work.displayed = after.displayed - before.displayed;
      report.work.evicted = after.evicted - before.evicted;
      owner.require(!after.active && !after.banners && !after.ticking && !after.ownedLayers
        && report.idleDiagnosticFrames === 0 && report.work.maxActive <= 32 && report.work.maxBanners <= 1, 'lifecycle-failed');
      owner.require(report.work.displayed === count, 'display-count-mismatch');
    }
    owner.require(report.work.accepted === count && report.samples.frameIntervalsMs.length > 0, 'work-incomplete');
    if (workload !== 'system-ten-hit' && !report.samples.dispatchToRenderCompleteMs.length) {
      if (!report.unavailable.some(value => value.metric === 'dispatchToRenderCompleteMs')) {
        report.unavailable.push({metric: 'dispatchToRenderCompleteMs', reasonCode: 'render-boundary-not-observed'});
      }
    }
    report.status = 'complete';
  } catch {
    if (owner) owner.error('benchmark-failed');
    else { report.errors.count++; report.errors.codes.push('fixture-rejected'); }
  } finally {
    stopFrames = true;
    const failedSteps = [];
    try { if (raf !== undefined) cancelAnimationFrame(raf); } catch { failedSteps.push('frame-observer'); }
    try { if (observer) runner.remove(observer); } catch { failedSteps.push('render-observer'); }
    report.work.rejected = Math.max(report.work.rejected, report.work.attempted - report.work.accepted);
    if (owner) {
      report.cleanup = await owner.restore();
      try { report.resources.afterClear = owner.snapshot(); } catch { failedSteps.push('final-diagnostics'); }
    }
    report.cleanup.failedSteps.push(...failedSteps);
    if (report.cleanup.failedSteps.length) report.cleanup.status = 'failed';
    if (report.cleanup.status === 'failed' || report.errors.count) report.status = 'failed';
    report.finishedAt = new Date().toISOString();
  }
  return report;
}

export function makeBenchmarkMacro(fixture, variant, pair, workload) {
  validateFixture(fixture);
  validateRequest(variant, pair, workload);
  return `(() => { const validateFixture = ${validateFixture.toString()}; const validateRequest = ${validateRequest.toString()}; const browserContext = ${browserContext.toString()}; return (${runBrowserBenchmark.toString()})(${JSON.stringify(fixture)}, ${JSON.stringify(variant)}, ${pair}, ${JSON.stringify(workload)}); })()`;
}

export function quantile(values, fraction) {
  if (!values.length || !values.every(value => Number.isFinite(value) && value >= 0) || !(fraction > 0 && fraction <= 1)) throw new Error('invalid-samples');
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
}

function validateReport(report) {
  const require = (value, code) => { if (!value) throw new Error(code); };
  const finite = value => Number.isFinite(value) && value >= 0;
  const string = value => typeof value === 'string' && value.length > 0;
  require(report?.schema === 1 && report.kind === 'benchmark' && report.status === 'complete', 'incomplete-report');
  require(['baseline', 'head'].includes(report.variant) && Number.isInteger(report.pair) && report.pair >= 1 && report.pair <= 5, 'invalid-pair');
  require(report.errors?.count === 0 && Array.isArray(report.errors.codes) && !report.errors.codes.length, 'run-errors');
  require(report.cleanup?.status === 'complete' && Array.isArray(report.cleanup.failedSteps) && !report.cleanup.failedSteps.length, 'cleanup-failed');
  const m = report.metadata;
  require(m?.schema === 1 && ['ten-hit', 'burst100', 'system-ten-hit'].includes(m.workload)
    && m.workloadVersion === 1 && m.measurementMode === 'uninstrumented' && m.warmupMs === 250
    && m.cadenceMs === (m.workload === 'burst100' ? 0 : 250), 'invalid-workload');
  require(report.actionProvenance === (m.workload === 'system-ten-hit' ? 'system-method' : 'renderer-api'), 'invalid-provenance');
  for (const key of ['runId', 'clientId', 'fixtureId', 'foundry', 'browser']) require(string(m[key]), 'missing-metadata');
  require(string(m.system?.id) && string(m.system.version), 'missing-system');
  require(/^[a-f0-9]{40}$/.test(m.install?.sha) && m.install.dirty === false
    && /^[a-f0-9]{64}$/.test(m.install.packageHash) && !/^0+$/.test(m.install.sha)
    && !/^0+$/.test(m.install.packageHash) && string(m.install.receipt), 'invalid-install');
  for (const key of ['label', 'cpu', 'ram', 'gpu', 'os', 'browserVersion']) require(string(m.machine?.[key]), 'missing-machine');
  for (const key of ['width', 'height']) require(finite(m.viewport?.[key]) && m.viewport[key] > 0, 'missing-viewport');
  require(finite(m.devicePixelRatio) && m.devicePixelRatio > 0, 'missing-viewport');
  require(finite(m.renderer?.type) && string(m.renderer?.pixi) && finite(m.renderer.width) && finite(m.renderer.height), 'missing-renderer');
  for (const key of ['width', 'height', 'grid', 'tokenCount', 'zoom', 'tokenWidth', 'tokenHeight']) require(finite(m.scene?.[key]) && m.scene[key] > 0, 'missing-scene');
  require(Array.isArray(m.modules) && m.modules.some(value => value.id === 'combat-pulse')
    && m.modules.every(value => string(value.id) && string(value.version)), 'missing-modules');
  for (const key of ['enabled', 'numbers', 'checks', 'banners', 'reactions', 'shake', 'reducedMotion']) require(typeof m.settings?.[key] === 'boolean', 'missing-settings');
  require(m.settings.enabled && m.settings.numbers && typeof m.effectiveReducedMotion === 'boolean'
    && typeof m.browserReducedMotion === 'boolean' && m.visibility === 'visible'
    && m.effectiveReducedMotion === (m.settings.reducedMotion || m.browserReducedMotion), 'invalid-settings');
  const count = m.workload === 'burst100' ? 100 : 10;
  const w = report.work;
  require(w?.attempted === count && w.completed === count && w.accepted === count && w.rejected === 0
    && w.displayed === count && Number.isInteger(w.evicted) && w.evicted >= 0
    && finite(w.maxActive) && w.maxActive <= 32 && finite(w.maxBanners) && w.maxBanners <= 1, 'incomplete-work');
  require(report.idleDiagnosticFrames === 0, 'idle-work');
  for (const key of ['before', 'afterBurst', 'afterExpiry', 'afterClear']) {
    const d = report.resources?.[key];
    require(d && ['active', 'banners', 'displayed', 'evicted', 'frames', 'ownedLayers'].every(name => Number.isInteger(d[name]) && d[name] >= 0)
      && typeof d.ticking === 'boolean', 'missing-diagnostics');
    if (key !== 'afterBurst') require(!d.active && !d.banners && !d.ticking && !d.ownedLayers, 'not-idle');
  }
  require(report.resources.afterExpiry.displayed - report.resources.before.displayed === count
    && report.resources.afterExpiry.evicted - report.resources.before.evicted === w.evicted, 'counter-mismatch');
  const s = report.samples;
  require(s && Array.isArray(s.dispatchMs) && s.dispatchMs.length === count && s.dispatchMs.every(finite), 'invalid-dispatch-samples');
  require(Array.isArray(s.frameIntervalsMs) && s.frameIntervalsMs.length > 0 && s.frameIntervalsMs.every(value => finite(value) && value > 0)
    && Array.isArray(s.frameTimestampsMs) && s.frameTimestampsMs.length === s.frameIntervalsMs.length + 1
    && s.frameTimestampsMs.every(finite), 'invalid-frame-samples');
  for (let index = 1; index < s.frameTimestampsMs.length; index++) {
    require(Math.abs(s.frameTimestampsMs[index] - s.frameTimestampsMs[index - 1] - s.frameIntervalsMs[index - 1]) < 0.001, 'frame-time-mismatch');
  }
  require(finite(report.windowStartedMs) && finite(report.windowFinishedMs) && report.windowFinishedMs > report.windowStartedMs
    && report.windowFinishedMs - report.windowStartedMs >= m.cadenceMs * (count - 1) + 2250
    && s.dispatchMs.reduce((total, value) => total + value, 0) <= report.windowFinishedMs - report.windowStartedMs
    && s.frameTimestampsMs[0] >= report.windowStartedMs && s.frameTimestampsMs.at(-1) <= report.windowFinishedMs, 'invalid-window');
  require(Array.isArray(s.dispatchToRenderCompleteMs) && s.dispatchToRenderCompleteMs.every(finite)
    && s.dispatchToRenderCompleteMs.length <= count && Array.isArray(report.unavailable), 'invalid-render-samples');
  const missingRender = report.unavailable.some(value => value.metric === 'dispatchToRenderCompleteMs' && string(value.reasonCode));
  require(Boolean(s.dispatchToRenderCompleteMs.length) !== missingRender, 'render-availability-mismatch');
  require(Number.isFinite(Date.parse(report.startedAt)) && Date.parse(report.finishedAt) > Date.parse(report.startedAt), 'invalid-dates');
}

function comparisonMetadata(metadata) {
  const {runId: _run, install: _install, ...comparable} = metadata;
  return comparable;
}

export function compareRuns(reports) {
  const result = {status: 'inconclusive', reasons: [], pairs: [], summaries: [], budgets: {status: 'uncalibrated'},
    limitations: ['Five pairs do not establish statistical confidence.', 'Render completion is not compositor presentation.']};
  try {
    if (!Array.isArray(reports) || reports.length !== 10) throw new Error('five-pairs-required');
    for (const report of reports) validateReport(report);
    const sequence = [...reports].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const canonical = value => JSON.stringify(value, (_key, entry) => entry && !Array.isArray(entry) && typeof entry === 'object'
      ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
    const metadata = canonical(comparisonMetadata(sequence[0].metadata));
    const renderAvailable = sequence[0].samples.dispatchToRenderCompleteMs.length > 0;
    const installs = new Map();
    const runIds = new Set();
    for (let index = 0; index < sequence.length; index++) {
      const report = sequence[index];
      const pair = Math.floor(index / 2) + 1;
      const expected = pair % 2 ? ['baseline', 'head'] : ['head', 'baseline'];
      if (report.pair !== pair || report.variant !== expected[index % 2]) throw new Error('invalid-interleaving');
      if (index && Date.parse(sequence[index - 1].finishedAt) >= Date.parse(report.startedAt)) throw new Error('overlapping-runs');
      if (runIds.has(report.metadata.runId)) throw new Error('duplicate-run');
      runIds.add(report.metadata.runId);
      if (canonical(comparisonMetadata(report.metadata)) !== metadata) throw new Error('unequal-metadata');
      if (Boolean(report.samples.dispatchToRenderCompleteMs.length) !== renderAvailable) throw new Error('unequal-metric-availability');
      const install = canonical(report.metadata.install);
      if (installs.has(report.variant) && installs.get(report.variant) !== install) throw new Error('variant-install-changed');
      installs.set(report.variant, install);
    }
    if (sequence.find(value => value.variant === 'baseline').metadata.install.sha === sequence.find(value => value.variant === 'head').metadata.install.sha) throw new Error('same-revision');
    const metrics = ['dispatchMs', 'frameIntervalsMs', 'dispatchToRenderCompleteMs'];
    for (let pair = 1; pair <= 5; pair++) {
      const runs = sequence.filter(value => value.pair === pair);
      const baseline = runs.find(value => value.variant === 'baseline');
      const head = runs.find(value => value.variant === 'head');
      const summaries = {};
      for (const metric of metrics) {
        const a = baseline.samples[metric], b = head.samples[metric];
        if (!a.length || !b.length) { summaries[metric] = {status: 'unavailable'}; continue; }
        summaries[metric] = {baseline: {count: a.length, p50: quantile(a, 0.5), p95: quantile(a, 0.95)},
          head: {count: b.length, p50: quantile(b, 0.5), p95: quantile(b, 0.95)}, p95DeltaMs: quantile(b, 0.95) - quantile(a, 0.95)};
      }
      result.pairs.push({pair, order: runs.map(value => value.variant), summaries});
    }
    for (const metric of metrics) {
      const baseline = sequence.filter(value => value.variant === 'baseline').flatMap(value => value.samples[metric]);
      const head = sequence.filter(value => value.variant === 'head').flatMap(value => value.samples[metric]);
      result.summaries.push({metric, ...(baseline.length && head.length
        ? {status: 'available', baseline: {count: baseline.length, p50: quantile(baseline, 0.5), p95: quantile(baseline, 0.95)},
          head: {count: head.length, p50: quantile(head, 0.5), p95: quantile(head, 0.95)}} : {status: 'unavailable'})});
    }
    result.status = 'comparable';
  } catch (error) {
    result.pairs = [];
    result.summaries = [];
    result.reasons.push(error.message);
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = cliOptions(process.argv.slice(3));
    if (process.argv[2] === 'emit') {
      if (Object.keys(options).some(key => !['fixture', 'variant', 'pair', 'workload'].includes(key))) throw new Error('invalid-arguments');
      process.stdout.write(makeBenchmarkMacro(JSON.parse(readFileSync(options.fixture, 'utf8')), options.variant,
        Number(options.pair), options.workload) + '\n');
    } else if (process.argv[2] === 'compare') {
      if (!options.reports || Object.keys(options).length !== 1) throw new Error('invalid-arguments');
      const result = compareRuns(JSON.parse(readFileSync(options.reports, 'utf8')));
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      if (result.status !== 'comparable') process.exitCode = 1;
    } else throw new Error('invalid-arguments');
  } catch { console.error('Use: benchmark.mjs emit --fixture=<local.json> --variant=baseline --pair=1 --workload=ten-hit OR compare --reports=<reports.json>'); process.exitCode = 1; }
}
