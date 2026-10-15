import { buildMesh } from '../geometry/mesh';
import { normalizeParams } from '../params/normalize';
import { diffParams, getPath, setPath, type ParamDiff } from '../params/paths';
import type { VaseParams } from '../params/schema';
import { analyze } from './index';
import { analyzeOverhang } from './overhang';
import type { Report } from './types';

/** A parameter that can be moved toward a neutral value to reduce overhang. */
interface Knob {
  path: string;
  neutral: (p: VaseParams) => number;
}

function knobsFor(p: VaseParams): Knob[] {
  const k: Knob[] = [
    { path: 'twist.total', neutral: () => 0 },
    { path: 'twist.lobes.depth', neutral: () => 0 },
    { path: 'twist.bend.offset', neutral: () => 0 },
    { path: 'profile.waveAmplitude', neutral: () => 0 },
    { path: 'rim.flare', neutral: () => 0 },
    { path: 'dimensions.maxDiameter', neutral: (q) => Math.max(q.dimensions.baseDiameter, q.dimensions.topDiameter) },
    {
      path: 'dimensions.neckDiameter',
      neutral: (q) => Math.min(q.dimensions.maxDiameter, Math.max(q.dimensions.baseDiameter, q.dimensions.topDiameter)),
    },
    { path: 'dimensions.topDiameter', neutral: (q) => q.dimensions.baseDiameter },
    { path: 'profile.strength', neutral: () => 0 },
  ];
  p.effects.forEach((e, i) => {
    if (!e.enabled) return;
    if (e.type === 'ribs') {
      k.push({ path: `effects.${i}.depth`, neutral: () => 0 });
      if (e.helixTurns !== 0) k.push({ path: `effects.${i}.helixTurns`, neutral: () => 0 });
    } else if (e.type === 'waves' || e.type === 'noise') {
      k.push({ path: `effects.${i}.amplitude`, neutral: () => 0 });
    } else if (e.type === 'organic') {
      k.push({ path: `effects.${i}.amount`, neutral: () => 0 });
    } else if (e.type === 'facets') {
      k.push({ path: `effects.${i}.jitter`, neutral: () => 0 });
    }
  });
  return k.filter((kn) => Math.abs((getPath(p, kn.path) as number) - kn.neutral(p)) > 1e-6);
}

function redArea(p: VaseParams): number {
  const { mesh } = buildMesh(p, 'low');
  const o = analyzeOverhang(mesh, p.print.maxOverhang).summary;
  return o.redFraction + 0.15 * o.yellowFraction;
}

function step(p: VaseParams, kn: Knob, factor: number): VaseParams {
  const v = getPath(p, kn.path) as number;
  const n = kn.neutral(p);
  let nv = n + (v - n) * factor;
  nv = Math.round(nv * 100) / 100;
  return normalizeParams(setPath(p, kn.path, nv));
}

export interface AutoFixResult {
  params: VaseParams;
  diff: ParamDiff[];
  before: number;
  after: number;
  iterations: number;
  report: Report;
}

const hasErrors = (r: Report) => r.issues.some((i) => i.severity === 'error');
const done = (r: Report) => !hasErrors(r) && r.score >= 90;

/**
 * "Make it printable": apply the direct parameter fixes, then iteratively reduce only the parameters
 * that contribute to the overhang (ablation-ranked) in 10 % steps, max 20 steps.
 */
export function autoFix(input: VaseParams, maxIter = 20): AutoFixResult {
  let p = input;
  // Decisions use preview resolution (what the user sees); ablation probes use the low grid.
  const evalP = (q: VaseParams) => analyze(buildMesh(q, 'medium'), q, { manifold: false });
  let report = evalP(p);
  const before = report.score;

  // 1) direct patches (walls, bounds, mode, feature depth, stability)
  for (let pass = 0; pass < 3; pass++) {
    const patches = report.issues.filter((i) => i.severity !== 'info' && i.fix?.kind === 'patch');
    if (!patches.length) break;
    for (const i of patches) {
      if (i.fix?.kind !== 'patch') continue;
      for (const c of i.fix.changes) p = setPath(p, c.path, c.value);
    }
    p = normalizeParams(p);
    report = evalP(p);
  }

  // 2) ablation-guided reduction for overhang / r_min issues
  let iterations = 0;
  const needsShape = (r: Report) =>
    r.issues.some((i) => (i.check === 'overhang' || i.id === 'sanity-rmin') && i.severity !== 'info');
  while (iterations < maxIter && !done(report) && needsShape(report)) {
    const base = redArea(p);
    const knobs = knobsFor(p);
    if (!knobs.length) break;
    let best: Knob | null = null;
    let bestGain = 1e-5;
    for (const kn of knobs) {
      const gain = base - redArea(step(p, kn, 0));
      if (gain > bestGain) {
        bestGain = gain;
        best = kn;
      }
    }
    if (!best) break;
    // keep stepping the same knob while it helps
    let cur = base;
    while (iterations < maxIter) {
      const next = step(p, best, 0.9);
      const val = redArea(next);
      iterations++;
      if (val > cur + 1e-6 && cur > 0) break;
      p = next;
      cur = val;
      report = evalP(p);
      if (done(report) || !needsShape(report)) break;
      if (Math.abs((getPath(p, best.path) as number) - best.neutral(p)) < 1e-3) break;
    }
  }

  return { params: p, diff: diffParams(input, p), before, after: report.score, iterations, report };
}
