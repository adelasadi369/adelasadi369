import { buildMesh, type BuildResult } from '../geometry/mesh';
import type { Quality } from '../geometry/grid';
import type { VaseParams } from '../params/schema';
import {
  boundsIssues,
  featureIssues,
  modeIssues,
  overhangIssues,
  sanityIssues,
  stabilityIssues,
  adviceForUseCase,
  wallIssues,
} from './checks';
import { boreIssues } from './bore';
import { analyzeOverhang } from './overhang';
import { computeStats } from './stats';
import type { Issue, Report } from './types';

export * from './types';

const ORDER = { error: 0, warn: 1, info: 2 } as const;

export function scoreOf(issues: Issue[]): number {
  let s = 100;
  for (const i of issues) s -= i.penalty;
  if (issues.some((i) => i.severity === 'error')) s = Math.min(s, 69);
  return Math.max(0, Math.round(s));
}

export function analyze(b: BuildResult, p: VaseParams, opts: { manifold?: boolean } = {}): Report {
  const maxDeg = p.print.maxOverhang;
  const oh = analyzeOverhang(b.mesh, maxDeg);
  const bounds = boundsIssues(b, p);
  const sanity = opts.manifold === false ? { issues: [], manifold: true } : sanityIssues(b);
  const issues = [
    ...overhangIssues(oh.summary, maxDeg),
    ...featureIssues(b, p),
    ...wallIssues(p),
    ...bounds.issues,
    ...modeIssues(p),
    ...stabilityIssues(b, p),
    ...boreIssues(b, p),
    ...sanity.issues,
    ...adviceForUseCase(p),
  ].sort((a, c) => ORDER[a.severity] - ORDER[c.severity]);
  return {
    score: scoreOf(issues),
    issues,
    stats: computeStats(b, p, bounds.sx, bounds.sy),
    overhang: oh.summary,
    vertexOverhang: oh.vertex,
    manifold: sanity.manifold,
  };
}

export function evaluate(p: VaseParams, quality: Quality = 'medium') {
  const build = buildMesh(p, quality);
  return { build, report: analyze(build, p) };
}
