import type { VaseParamsInput } from '../src/core/params/schema';

/** Source definitions for the trend presets. `npm run presets` expands them into full JSON in src/presets/. */
export const PRESET_SOURCES: { id: string; name: { fa: string; en: string }; params: VaseParamsInput }[] = [
  {
    id: 'japandi-ribbed',
    name: { fa: 'جاپاندی شیاردار', en: 'Japandi Ribbed' },
    params: {
      dimensions: {
        height: 180,
        baseDiameter: 100,
        maxDiameter: 128,
        neckDiameter: 100,
        topDiameter: 104,
        bellyPosition: 42,
        neckPosition: 84,
      },
      profile: { preset: 'jar', strength: 55 },
      effects: [{ type: 'ribs', count: 60, depth: 2.5, profile: 'round', widthRatio: 0.55, fade: 3 }],
      render: { color: '#d9cbb5', viewMaterial: 'matte' },
    },
  },
  {
    id: 'twisted-hex',
    name: { fa: 'شش‌ضلعی پیچان', en: 'Twisted Hex' },
    params: {
      dimensions: { height: 180, baseDiameter: 84, maxDiameter: 100, topDiameter: 82, bellyPosition: 45 },
      profile: { preset: 'convex', strength: 40 },
      section: { bottom: { shape: 'polygon', sides: 6, cornerRadius: 3 } },
      twist: { total: 120, curve: 'easeInOut' },
      render: { color: '#7d9a8c', viewMaterial: 'silk' },
    },
  },
  {
    id: 'fluted-column',
    name: { fa: 'ستون شیاردار', en: 'Fluted Column' },
    params: {
      dimensions: { height: 200, baseDiameter: 92, topDiameter: 92 },
      profile: { preset: 'straight' },
      effects: [
        {
          type: 'ribs',
          count: 24,
          depth: 4,
          profile: 'V',
          style: 'grooved',
          widthRatio: 0.8,
          start: 4,
          end: 96,
          fade: 3,
        },
      ],
      render: { color: '#efece6', viewMaterial: 'matte' },
    },
  },
  {
    id: 'helix-ribs',
    name: { fa: 'دنده‌های مارپیچ', en: 'Helix Ribs' },
    params: {
      dimensions: { height: 200, baseDiameter: 86, maxDiameter: 100, topDiameter: 80, bellyPosition: 40 },
      profile: { preset: 'convex', strength: 35 },
      effects: [{ type: 'ribs', count: 36, depth: 1, profile: 'V', widthRatio: 0.6, helixTurns: 1.5 }],
      render: { color: '#c47b5a', viewMaterial: 'silk' },
    },
  },
  {
    id: 'ripple-wave',
    name: { fa: 'موج آب', en: 'Ripple Wave' },
    params: {
      dimensions: { height: 180, baseDiameter: 90, topDiameter: 80 },
      profile: { preset: 'taper' },
      effects: [{ type: 'waves', amplitude: 2, freqZ: 12, freqTheta: 0, start: 3, end: 97, fade: 4 }],
      render: { color: '#8fb3c9', viewMaterial: 'gloss' },
    },
  },
  {
    id: 'star-bloom',
    name: { fa: 'شکوفهٔ ستاره', en: 'Star Bloom' },
    params: {
      dimensions: {
        height: 180,
        baseDiameter: 78,
        maxDiameter: 104,
        neckDiameter: 86,
        topDiameter: 100,
        bellyPosition: 40,
        neckPosition: 78,
      },
      profile: { preset: 'tulip', strength: 50 },
      section: { bottom: { shape: 'star', starPoints: 8, starInnerRatio: 0.78 } },
      twist: { total: 90, curve: 'linear' },
      render: { color: '#e3a5b4', viewMaterial: 'silk' },
    },
  },
  {
    id: 'silk-drape',
    name: { fa: 'پردهٔ ابریشمی', en: 'Silk Drape' },
    params: {
      dimensions: { height: 190, baseDiameter: 84, maxDiameter: 110, topDiameter: 64, bellyPosition: 32 },
      profile: { preset: 'teardrop', strength: 45 },
      effects: [
        { type: 'organic', style: 'silkFolds', amount: 3, scale: 30, stretch: 6, seed: 7, start: 4, end: 100, fade: 8 },
      ],
      print: { material: 'silkPLA' },
      render: { color: '#c9b37a', viewMaterial: 'silk' },
    },
  },
  {
    id: 'low-poly-facet',
    name: { fa: 'چندوجهی', en: 'Low-Poly Facet' },
    params: {
      dimensions: { height: 170, baseDiameter: 84, maxDiameter: 108, topDiameter: 78, bellyPosition: 45 },
      profile: { preset: 'convex', strength: 50 },
      effects: [{ type: 'facets', angularSegments: 9, verticalSegments: 6, jitter: 1.5, seed: 3, fade: 0 }],
      render: { color: '#9aa0a8', viewMaterial: 'matte' },
    },
  },
];
