/** Context shared by offset effects. */
export interface EffectCtx {
  height: number;
  /** Reference radius for isotropic noise sampling (maxDiameter / 2). */
  refRadius: number;
}

/** Radial offset in mm at warped angle θw, height fraction t (z = t·H). */
export type OffsetFn = (thetaW: number, cosW: number, sinW: number, t: number) => number;

/** Modifier effects replace the accumulated radius v (blended by the mask). */
export type ModifyFn = (thetaW: number, cosW: number, sinW: number, t: number, v: number) => number;

/** Evaluates base + all preceding effects at (θw, t) — used by modifiers that need other samples. */
export type PrevEval = (thetaW: number, t: number) => number;

export interface CompiledEffect {
  type: string;
  mask: (t: number) => number;
  offset: OffsetFn;
  modify?: ModifyFn;
  /** Extra row breakpoints (fractions of height). */
  rowBreaks?: number[];
  /** Repetitions around the circumference (0 if not periodic). */
  repetitions: number;
  /** True when the pattern is exactly periodic (grid columns should be a multiple of `repetitions`). */
  periodic: boolean;
  /** Required grid samples per repetition. */
  samplesPerRep: number;
  /** Vertical cycles over the full height (for Nz auto-raise). */
  verticalCycles: number;
  /** Helix turns (ribs) – used for grid alignment. */
  helixTurns: number;
  /** Peak radial depth in mm (feature checks). */
  depth: number;
  /** Max inward offset in mm (shell liner). */
  inward: number;
  /** Phase-2+ effect that the Phase-1 engine skips. */
  unsupported?: boolean;
}
