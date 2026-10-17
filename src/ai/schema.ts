/**
 * Response contracts for the AI module. The model only ever returns PARAMETERS (never geometry).
 * Values travel as JSON strings (`valueJson`) so one small schema covers numbers, enums, booleans
 * and whole effect objects; the client validates every change through the param schema.
 */
import { z } from 'zod';

export const I18nSummary = z.object({
  fa: z.string().describe('One or two sentences in Persian explaining the interpretation.'),
  en: z.string().describe('The same summary in English.'),
});

export const ParamChange = z.object({
  path: z
    .string()
    .describe('Dot path of a parameter, e.g. "dimensions.height", or "effects" for the whole effect list.'),
  valueJson: z
    .string()
    .describe('The new value encoded as JSON, e.g. "150", "\\"tulip\\"", "true", or an effects array.'),
});

export const DesignProposal = z.object({
  basePreset: z.string().describe('id of the closest preset to start from.'),
  changes: z.array(ParamChange).describe('Only the parameters that differ from the base preset.'),
  summary: I18nSummary,
});
export type DesignProposal = z.infer<typeof DesignProposal>;

export const PatchOperation = z.object({
  op: z.enum(['add', 'remove', 'replace', 'move', 'copy', 'test']),
  path: z.string().describe('RFC 6901 JSON pointer, e.g. "/twist/total" or "/effects/0/depth".'),
  from: z.string().nullable().describe('Source pointer for move/copy, otherwise null.'),
  valueJson: z.string().nullable().describe('JSON-encoded value for add/replace/test, otherwise null.'),
});

export const RefinePatch = z.object({
  ops: z.array(PatchOperation),
  summary: I18nSummary,
});
export type RefinePatch = z.infer<typeof RefinePatch>;

export const ImageAnalysis = z.object({
  heightToWidth: z.number().describe('Overall height divided by the widest diameter.'),
  profile: z
    .array(
      z.object({ t: z.number().describe('Height fraction 0..1'), r: z.number().describe('Radius / max radius, 0..1') }),
    )
    .describe('Radius factors at 8 heights from base (t=0) to rim (t=1).'),
  section: z.enum(['circle', 'polygon', 'star', 'flower', 'superellipse']),
  sides: z.number().nullable().describe('Number of sides/points/petals for polygon, star or flower; else null.'),
  ribs: z
    .object({ count: z.number(), depthMm: z.number(), grooved: z.boolean(), helixTurns: z.number() })
    .nullable()
    .describe('Vertical or helical ribs/flutes, null if none.'),
  texture: z
    .enum(['honeycomb', 'knurl', 'diamond', 'basketweave', 'chevron', 'scales', 'hammered', 'bark', 'rope', 'dots'])
    .nullable(),
  twistDeg: z.number().describe('Total visible twist of the section from base to rim, degrees.'),
  colorHex: z.string().describe('Dominant colour as #rrggbb.'),
  summary: I18nSummary,
});
export type ImageAnalysis = z.infer<typeof ImageAnalysis>;

/** Request bodies accepted by the proxy. */
export const ParamsRequest = z.object({
  prompt: z.string().min(1).max(2000),
  lang: z.enum(['fa', 'en']).default('fa'),
});
export const RefineRequest = z.object({
  params: z.unknown(),
  message: z.string().min(1).max(1000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(2000) }))
    .max(20)
    .default([]),
});
export const ImageRequest = z.object({
  imageBase64: z.string().max(7_000_000),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  note: z.string().max(500).default(''),
  silhouette: z
    .array(z.object({ t: z.number(), r: z.number() }))
    .max(16)
    .nullable()
    .default(null),
});
