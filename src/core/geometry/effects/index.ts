import type { Effect } from '../../params/schema';
import { facetsModifier } from './facets';
import { glitchModifier } from './glitch';
import { windowMask } from './mask';
import { organicOffset } from './organic';
import { noiseOffset } from './noise';
import { ribsOffset } from './ribs';
import { stepsModifier } from './steps';
import { textureOffset, textureRepeats } from './textures';
import type { CompiledEffect, EffectCtx, PrevEval } from './types';
import { wavesOffset } from './waves';

export type { CompiledEffect, EffectCtx, OffsetFn, PrevEval } from './types';

export function compileEffect(e: Effect, ctx: EffectCtx, prev: PrevEval): CompiledEffect {
  const mask = windowMask(e.start, e.end, e.fade);
  const common = {
    type: e.type,
    mask,
    repetitions: 0,
    periodic: true,
    samplesPerRep: 8,
    verticalCycles: 0,
    helixTurns: 0,
    depth: 0,
    inward: 0,
  };
  switch (e.type) {
    case 'ribs': {
      const reps = e.crisscross && e.helixTurns !== 0 ? 2 * e.count : e.count;
      return {
        ...common,
        offset: ribsOffset(e),
        repetitions: reps,
        helixTurns: e.helixTurns,
        verticalCycles: Math.abs(e.helixTurns) * e.count * (e.crisscross ? 1 : 0),
        depth: e.depth,
        inward: e.style === 'grooved' ? e.depth : 0,
      };
    }
    case 'waves':
      return {
        ...common,
        offset: wavesOffset(e),
        repetitions: e.freqTheta,
        verticalCycles: e.freqZ,
        depth: 2 * e.amplitude,
        inward: e.amplitude,
      };
    case 'noise': {
      const featureMm = e.scale / Math.pow(2, e.octaves - 1);
      return {
        ...common,
        offset: noiseOffset(e, ctx),
        repetitions: Math.ceil((2 * Math.PI * ctx.refRadius) / featureMm),
        periodic: false,
        samplesPerRep: 4,
        verticalCycles: (ctx.height / featureMm) * 0.5,
        depth: e.amplitude,
        inward: e.amplitude,
      };
    }
    case 'organic': {
      const featureMm = e.style === 'silkFolds' ? e.scale / 2 : e.scale;
      return {
        ...common,
        offset: organicOffset(e, ctx),
        repetitions: Math.ceil((2 * Math.PI * ctx.refRadius) / featureMm),
        periodic: false,
        samplesPerRep: 4,
        verticalCycles: (ctx.height / (e.scale * (e.style === 'silkFolds' ? e.stretch : 1))) * 0.5,
        depth: e.amount,
        inward: e.amount,
      };
    }
    case 'facets': {
      const f = facetsModifier(e, ctx.height, prev);
      return {
        ...common,
        offset: () => 0,
        modify: f.modify,
        rowBreaks: f.rowBreaks,
        repetitions: e.angularSegments,
        samplesPerRep: 24,
        depth: 0,
        inward: e.jitter + 1,
      };
    }
    case 'texture': {
      const tx = textureOffset(e, ctx);
      const reps = textureRepeats(e);
      return {
        ...common,
        offset: tx.offset,
        repetitions: reps,
        periodic: e.pattern !== 'bark',
        samplesPerRep: 8,
        verticalCycles: ctx.height / tx.cellHeight,
        depth: e.depth,
        inward: e.depth,
      };
    }
    case 'steps': {
      const st = stepsModifier(e, prev);
      return {
        ...common,
        offset: () => 0,
        modify: st.modify,
        rowBreaks: st.rowBreaks,
        periodic: false,
        depth: 0,
        inward: 0,
      };
    }
    case 'glitch': {
      const g = glitchModifier(e, ctx.height, ctx.refRadius, ctx.maxOverhang, prev);
      return {
        ...common,
        offset: () => 0,
        modify: g.modify,
        rowBreaks: g.rowBreaks,
        periodic: false,
        depth: 0,
        inward: e.maxOffset,
      };
    }
    default:
      return { ...common, offset: () => 0, unsupported: true };
  }
}
