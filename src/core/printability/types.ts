import type { I18nText } from '../params/schema';

export type Severity = 'info' | 'warn' | 'error';
export type CheckId = 'overhang' | 'features' | 'walls' | 'bounds' | 'mode' | 'stability' | 'sanity' | 'useCase';

export interface ParamChange {
  path: string;
  value: unknown;
}

export type FixAction =
  | { kind: 'patch'; label: I18nText; changes: ParamChange[] }
  /** Run the iterative auto-fix. */
  | { kind: 'autofix'; label: I18nText };

export interface Issue {
  id: string;
  check: CheckId;
  severity: Severity;
  /** Height range in % of height. */
  heightRange?: [number, number];
  message: I18nText;
  fix?: FixAction;
  penalty: number;
}

export interface Stats {
  height: number;
  maxDiameter: number;
  bboxX: number;
  bboxY: number;
  capacityMl: number;
  materialCm3: number;
  weightG: number;
  printMinutes: number;
  surfaceCm2: number;
  triangles: number;
  stlBytes: number;
}

export interface OverhangSummary {
  maxDeg: number;
  redFraction: number;
  yellowFraction: number;
  /** Per band (50 bands): fraction of band wall area above the red limit. */
  bandsRed: Float32Array;
  bandsYellow: Float32Array;
}

export interface Report {
  score: number;
  issues: Issue[];
  stats: Stats;
  overhang: OverhangSummary;
  /** Per-vertex overhang angle in degrees (−1 where not applicable). */
  vertexOverhang: Float32Array;
  manifold: boolean;
}
