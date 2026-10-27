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
import { motifIssues } from './motif';
import { analyzeOverhang } from './overhang';
import { scoreOf } from './score';
import { analyzeSleeve } from './sleeve';
import { buildSleeveMesh, sleeveVoxel, type SleeveBuild } from '../sleeve';
import { computeStats } from './stats';
import type { Report } from './types';

export * from './types';

const ORDER = { error: 0, warn: 1, info: 2 } as const;

export { scoreOf };

/** Printability report; sleeves (SDF path) go to analyzeSleeve, every vase mode to the grid checks below. */
export function analyze(b: BuildResult | SleeveBuild, p: VaseParams, opts: { manifold?: boolean } = {}): Report {
  if ('sdf' in b) return analyzeSleeve(b, p);
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
    ...motifIssues(p, p.dimensions.height),
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
  const build = buildDesign(p, quality);
  return { build, report: analyze(build, p) };
}

/** The deterministic build for any output mode: grid path for vases, SDF + marching cubes for sleeves. */
export function buildDesign(p: VaseParams, quality: Quality): BuildResult | SleeveBuild {
  return p.print.outputMode === 'sleeve' ? buildSleeveMesh(p, sleeveVoxel(p, quality)) : buildMesh(p, quality);
}
