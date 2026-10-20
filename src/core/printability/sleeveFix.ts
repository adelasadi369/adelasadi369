import { normalizeParams } from '../params/normalize';
import { diffParams, getPath, setPath } from '../params/paths';
import type { VaseParams } from '../params/schema';
import { buildSleeveMesh, DRAG_VOXEL } from '../sleeve';
import type { AutoFixResult } from './autofix';
import { analyzeSleeve, BORE_CONTACT_MIN, minWall } from './sleeve';
import type { Report } from './types';

/**
 * Sleeve auto-fix (docs/sleeve-integration.md §7): the vase ablation approach on the sleeve path. Direct patches from
 * the issues first (hole fixes), then, while issues remain, every knob that is away from its neutral value is probed
 * at its neutral value on a coarse 3 mm lattice; the knob that lowers the cost most is stepped toward neutral
 * while it keeps helping. Decisions use the 2 mm drag voxel. insert.* and the printer are never touched.
 * Shape problems are worked first, then hole problems, each with its own knobs and cost (see cost()). Steps are 25 %
 * (not the vase path's 10 %) because every probe is a sleeve build.
 */
interface Knob {
  path: string;
  neutral: (p: VaseParams) => number;
}

const PROBE_VOXEL = 3;

type Phase = 'shape' | 'holes';

/** Which problem to work on next: shape (overhang, walls, mesh) first, then holes; null when nothing is left. */
function phaseOf(r: Report): Phase | null {
  const open = r.issues.filter((i) => i.severity !== 'info');
  if (open.some((i) => i.check === 'overhang' || i.id === 'sleeve-wall' || i.id === 'sleeve-mesh')) return 'shape';
  if (open.some((i) => /^sleeve-(bridges|bore-contact|islands)/.test(i.id))) return 'holes';
  return null;
}

/** Knobs for one phase only (each probe is a sleeve build). */
function knobsFor(p: VaseParams, phase: Phase): Knob[] {
  const s = p.sleeve;
  const shape = phase === 'shape';
  const holes = phase === 'holes';
  const k: Knob[] = [];
  if (shape)
    k.push(
      { path: 'twist.total', neutral: () => 0 },
      { path: 'twist.lobes.depth', neutral: () => 0 },
      { path: 'twist.bend.offset', neutral: () => 0 },
      { path: 'dimensions.maxDiameter', neutral: (q) => Math.max(q.dimensions.baseDiameter, q.dimensions.topDiameter) },
      { path: 'rim.flare', neutral: () => 0 },
    );
  if (holes && s.holes.mode !== 'none') {
    k.push({ path: 'sleeve.holes.coverage', neutral: () => 0 });
    k.push({ path: 'sleeve.holes.size', neutral: () => 4 });
    k.push({ path: 'sleeve.holes.minBridgeWidth', neutral: () => Math.max(s.holes.minBridgeWidth, 8) });
  }
  if (shape && s.fingers.count > 0) {
    k.push({ path: 'sleeve.fingers.lean', neutral: () => 0 });
    k.push({ path: 'sleeve.fingers.curl', neutral: () => 0 });
    k.push({ path: 'sleeve.fingers.width', neutral: () => Math.max(s.fingers.width, 16) });
  }
  if (shape && s.drips.count > 0) k.push({ path: 'sleeve.drips.bulbSize', neutral: () => 3 });
  p.effects.forEach((e, i) => {
    if (!e.enabled || !shape) return;
    if (e.type === 'ribs' || e.type === 'texture') k.push({ path: `effects.${i}.depth`, neutral: () => 0 });
    else if (e.type === 'waves' || e.type === 'noise') k.push({ path: `effects.${i}.amplitude`, neutral: () => 0 });
    else if (e.type === 'organic') k.push({ path: `effects.${i}.amount`, neutral: () => 0 });
    else if (e.type === 'facets') k.push({ path: `effects.${i}.jitter`, neutral: () => 0 });
    else if (e.type === 'glitch') k.push({ path: `effects.${i}.maxOffset`, neutral: () => 0 });
  });
  return k.filter((kn) => Math.abs((getPath(p, kn.path) as number) - kn.neutral(p)) > 1e-6);
}

/**
 * Shape cost: overhang + wall deficit + validity, probed without holes (teardrops keep hole roofs printable, and the
 * hole map is the slow part). Hole cost: thin bridges + bore-contact deficit + removed islands.
 */
function cost(p: VaseParams, phase: Phase): number {
  if (phase === 'holes') {
    const b = buildSleeveMesh(p, PROBE_VOXEL);
    const hs = b.mesh.sleeve.holes;
    const isl = b.mesh.sleeve.islands.removedFraction;
    return (hs ? (hs.thinBridges ? 0.3 : 0) + Math.max(0, BORE_CONTACT_MIN - hs.boreContact) : 0) + isl;
  }
  const q = p.sleeve.holes.mode === 'none' ? p : setPath(p, 'sleeve.holes.mode', 'none');
  const b = buildSleeveMesh(q, PROBE_VOXEL);
  const r = analyzeSleeve(b, q);
  const wall = minWall(b, 1500).thickness;
  return (
    r.overhang.redFraction +
    0.15 * r.overhang.yellowFraction +
    Math.max(0, 2 * p.print.lineWidth - wall) +
    b.mesh.sleeve.islands.removedFraction +
    (b.mesh.sleeve.validity.ok ? 0 : 1)
  );
}

function step(p: VaseParams, kn: Knob, factor: number): VaseParams {
  const v = getPath(p, kn.path) as number;
  const n = kn.neutral(p);
  const nv = Math.round((n + (v - n) * factor) * 100) / 100;
  return normalizeParams(setPath(p, kn.path, nv));
}

const hasErrors = (r: Report) => r.issues.some((i) => i.severity === 'error');
const done = (r: Report) => !hasErrors(r) && r.score >= 90 && !r.issues.some((i) => i.severity === 'warn');

export function sleeveAutoFix(input: VaseParams, maxIter = 8): AutoFixResult {
  let p = input;
  const evalP = (q: VaseParams) => analyzeSleeve(buildSleeveMesh(q, DRAG_VOXEL), q);
  let report = evalP(p);
  const before = report.score;

  // 1) direct patches (hole coverage, size, bridges, keep-outs), never touching the insert or the printer
  for (let pass = 0; pass < 3 && !done(report); pass++) {
    const patches = report.issues.filter((i) => i.severity !== 'info' && i.fix?.kind === 'patch');
    if (!patches.length) break;
    for (const i of patches) {
      if (i.fix?.kind !== 'patch') continue;
      for (const c of i.fix.changes)
        if (!c.path.startsWith('insert.') && !c.path.startsWith('print.printer.')) p = setPath(p, c.path, c.value);
    }
    p = normalizeParams(p);
    report = evalP(p);
  }

  // 2) ablation-guided reduction; a knob whose first step does not help is skipped until another knob moves
  let iterations = 0;
  const stuck = new Set<string>();
  while (iterations < maxIter && !done(report)) {
    const phase = phaseOf(report);
    if (!phase) break;
    const base = cost(p, phase);
    let best: Knob | null = null;
    let bestGain = 1e-5;
    for (const kn of knobsFor(p, phase)) {
      if (stuck.has(kn.path)) continue;
      const gain = base - cost(step(p, kn, 0), phase);
      if (gain > bestGain) {
        bestGain = gain;
        best = kn;
      }
    }
    if (!best) break;
    let cur = base;
    let moved = false;
    while (iterations < maxIter) {
      const next = step(p, best, 0.75);
      const val = cost(next, phase);
      iterations++;
      if (val > cur + 1e-6) break;
      p = next;
      cur = val;
      moved = true;
      report = evalP(p);
      if (done(report) || phaseOf(report) !== phase) break;
      if (Math.abs((getPath(p, best.path) as number) - best.neutral(p)) < 1e-3) break;
    }
    if (moved) stuck.clear();
    else stuck.add(best.path);
  }

  return { params: p, diff: diffParams(input, p), before, after: report.score, iterations, report };
}
