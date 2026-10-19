import type { Issue } from './types';

/** Score = 100 − Σ penalties; any error caps it at 69. */
export function scoreOf(issues: Issue[]): number {
  let s = 100;
  for (const i of issues) s -= i.penalty;
  if (issues.some((i) => i.severity === 'error')) s = Math.min(s, 69);
  return Math.max(0, Math.round(s));
}
