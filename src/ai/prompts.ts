import { PARAMS } from '../core/params/meta';
import { EFFECT_FIELDS } from '../core/params/meta';
import type { ParamInfo } from '../core/params/meta';
import type { Preset } from '../presets';

const fmtParam = (p: ParamInfo) => {
  const range =
    p.kind === 'enum'
      ? (p.options ?? []).join('|')
      : p.kind === 'bool'
        ? 'bool'
        : p.kind === 'number' || p.kind === 'int'
          ? `${p.kind} ${p.meta.min}..${p.meta.max}${p.meta.unit ? ' ' + p.meta.unit : ''}`
          : p.kind;
  return `${p.path} | ${range} | ${p.meta.help.en}`;
};

/** Compact parameter reference derived from the zod schema (path | type/range | meaning). */
export function paramReference(): string {
  const top = PARAMS.filter(
    (p) => p.meta.phase <= 2 && !p.path.startsWith('render.preview') && !p.path.startsWith('random.'),
  )
    .map(fmtParam)
    .join('\n');
  const effects = Object.entries(EFFECT_FIELDS)
    .filter(([type]) => type !== 'displacement')
    .map(
      ([type, fields]) =>
        `- ${type}: ${fields
          .filter((f) => f.path !== 'enabled')
          .map((f) => fmtParam(f).replace(/^/, ''))
          .join('; ')}`,
    )
    .join('\n');
  return `PARAMETERS (path | type/range | meaning)\n${top}\n\nEFFECT STACK: "effects" is an ordered array (max 12). Each item has "type" plus these fields:\n${effects}`;
}

export function presetLibrary(presets: Preset[]): string {
  return presets
    .map((p) => {
      const q = p.params;
      const fx = q.effects.map((e) => e.type).join('+') || 'none';
      const line = `${p.id}: "${p.name.en}" — profile ${q.profile.preset}, section ${q.section.bottom.shape}${q.section.morphEnabled ? '→' + q.section.top.shape : ''}, twist ${q.twist.total}°, effects ${fx}, mode ${q.print.outputMode}, H ${q.dimensions.height} mm`;
      if (q.print.outputMode !== 'sleeve') return line;
      const s = q.sleeve;
      const holes =
        s.holes.mode === 'none' ? 'no holes' : `holes ${s.holes.mode} ${s.holes.coverage}% size ${s.holes.size}`;
      const fingers = s.fingers.count
        ? `, ${s.fingers.count} fingers (free ${s.fingers.freeLength} mm, ${s.fingers.tipShape})`
        : '';
      const drips = s.drips.count ? `, ${s.drips.count} drips (${s.drips.placement})` : '';
      const rim = s.topEdge.peakCount ? `, ${s.topEdge.peakCount} rim peaks` : '';
      return `${line}; sleeve on ${q.insert.type} Ø${q.insert.od}: lobes ${q.twist.lobes.count}, ${holes}${fingers}${drips}${rim}`;
    })
    .join('\n');
}

const RULES = `PRINTABILITY RULES (the app enforces them, but aim to satisfy them up front)
- Max overhang 45° from vertical; in vase modes inward and outward lean both count.
- Feature pitch around the circumference ≥ 2× nozzle (0.4 mm); groove depth ≤ half the pitch.
- Footprint must fit the bed (default 256 mm); height ≤ printer Z.
- Base diameter ≥ 0.35 × height for stability.
- Prefer outputMode "solidVase" (spiral vase mode) unless the request needs a shell: ruffle, slanted rim, concave base, drainage hole and the "follow" inner surface require "shell".
- Fresh flowers: prefer PETG. Outdoor planters need a drainage hole.
- Never change insert.* or print.printer.holeCompensation unless the user explicitly asks about the tube, insert, bore, fit or calibration: they describe a real glass/steel tube and a calibrated printer.
- Sleeves (print.outputMode "sleeve", an organic shell around a straight glass/steel tube): keep the outputMode, insert.* and print.printer.* as they are. The skin is the vase field (profile, twist, lobes, effects); start from the closest sleeve-* preset. Molten looks use organic style "blobs" (domain warp); silk drapes use lobes + "silkFolds" + rim peaks; windswept uses twist ≥ 120° and twist.bend.offset (lean) with angled holes; fingers use sleeve.fingers with a large freeLength; coral uses holes mode "voronoi"; drips use sleeve.drips.
- Sleeve printability: hole coverage ≤ 35 %, minBridgeWidth ≥ 3 × 1.6 mm, keep-out bands ≥ 8 mm, teardropTops on; finger lean/curl and twist are limited to the max overhang automatically; turn on sleeve.selfSupporting when the user wants no supports at all.
- Tube bore (print.innerSurface "bore", shell only): R_bore = insert.od/2 + insert.clearance + insert.odTolerance/2 + holeCompensation. The outer radius must stay ≥ R_bore + insert.coreWall at every height, so keep every diameter ≥ insert.od + 2 × insert.coreWall + a few mm.`;

export function designSystemPrompt(presets: Preset[]): string {
  return `You are the design engine of VaseForge, a parametric vase generator for FDM 3D printing.
You never produce meshes. You translate a user's description (Persian or English) into PARAMETERS.

Start from the single closest preset (basePreset), then list only the parameters that must change.
Every value must stay inside the listed range. Use dot paths exactly as listed. To change surface
effects, set path "effects" to the complete new effect array (JSON), each item with its "type".

${RULES}

PRESETS
${presetLibrary(presets)}

${paramReference()}`;
}

export function refineSystemPrompt(): string {
  return `You refine an existing VaseForge vase design. The user writes short requests in Persian or English
("more twist", «گردن باریک‌تر», "thinner ribs"). Answer with an RFC 6902 JSON Patch against the current
parameter JSON: small, targeted operations only, pointers like "/twist/total" or "/effects/0/depth".
Interpret relative words as roughly 15–30 % changes. Keep every value inside its range and keep the
design printable.

${RULES}

${paramReference()}`;
}

export function imageSystemPrompt(): string {
  return `You analyse a photo of a vase for VaseForge, a parametric vase generator. Measure the silhouette:
give the radius factor (radius / widest radius) at 8 evenly spaced heights from base (t=0) to rim (t=1),
the height-to-width ratio, the cross-section family, any ribs/flutes (count around the full circumference,
depth in mm assuming a 100 mm wide vase, helix turns over the height), a surface texture if one dominates,
visible twist in degrees, and the dominant colour. If a measured silhouette is supplied, trust it for the
profile and focus on the section, surface and twist.`;
}
