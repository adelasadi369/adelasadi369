import { describe, expect, it, vi } from 'vitest';
import { handle } from '../server/ai';
import { applyImageAnalysis, applyProposal, applyRefine } from '../src/ai/apply';
import { designSystemPrompt, refineSystemPrompt } from '../src/ai/prompts';
import { VaseParamsSchema } from '../src/core/params/schema';
import { PRESETS } from '../src/presets';

function mockClient(result: { parsed_output: unknown; stop_reason?: string; model?: string }) {
  const parse = vi.fn().mockResolvedValue({ stop_reason: 'end_turn', model: 'claude-opus-5-5', ...result });
  return { client: { beta: { messages: { parse } } } as never, parse };
}

describe('AI proxy handler', () => {
  it('text → params: sends a cached system prompt, structured output, fallbacks; returns parsed data', async () => {
    const proposal = {
      basePreset: 'twisted-hex',
      changes: [{ path: 'twist.total', valueJson: '200' }],
      summary: { fa: 'الف', en: 'a' },
    };
    const { client, parse } = mockClient({ parsed_output: proposal });
    const r = await handle('params', { prompt: 'یک گلدان پیچان شش‌ضلعی', lang: 'fa' }, () => client);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, data: proposal });
    const req = parse.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.output_config.effort).toBe('medium');
    expect(req.output_config.format).toBeTruthy();
    expect(req.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(req.system[0].text).toContain('twisted-hex'); // preset library
    expect(req.system[0].text).toContain('dimensions.height'); // parameter reference
  });

  it('refusals and unparseable output become typed errors', async () => {
    let r = await handle(
      'params',
      { prompt: 'x' },
      () => mockClient({ parsed_output: null, stop_reason: 'refusal' }).client,
    );
    expect(r).toMatchObject({ status: 422, body: { ok: false, error: { code: 'refused' } } });
    r = await handle('params', { prompt: 'x' }, () => mockClient({ parsed_output: null }).client);
    expect(r).toMatchObject({ status: 502, body: { error: { code: 'invalid_output' } } });
  });

  it('validates request bodies and reports a missing key', async () => {
    const { client } = mockClient({ parsed_output: {} });
    expect((await handle('params', { prompt: '' }, () => client)).status).toBe(400);
    expect((await handle('image', { imageBase64: 'x', mediaType: 'image/bmp' }, () => client)).status).toBe(400);
    const r = await handle('params', { prompt: 'x' }, () => {
      throw new Error('no key');
    });
    expect(r).toMatchObject({ status: 503, body: { error: { code: 'not_configured' } } });
  });

  it('image requests send the image block first, then the silhouette hint', async () => {
    const { client, parse } = mockClient({ parsed_output: {} });
    await handle(
      'image',
      { imageBase64: 'AAAA', mediaType: 'image/png', silhouette: [{ t: 0, r: 0.8 }] },
      () => client,
    );
    const content = parse.mock.calls[0][0].messages[0].content;
    expect(content[0]).toMatchObject({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAAA' },
    });
    expect(content[1].text).toContain('(0.00, 0.80)');
  });
});

describe('applying AI output', () => {
  it('proposal: starts from the preset, applies known paths, clamps, rejects unknown paths', () => {
    const { params, rejected } = applyProposal(
      {
        basePreset: 'japandi-ribbed',
        changes: [
          { path: 'dimensions.height', valueJson: '999' },
          { path: 'twist.total', valueJson: '45' },
          { path: 'profile.preset', valueJson: 'tulip' }, // bare string tolerated
          { path: 'bogus.path', valueJson: '1' },
          { path: 'effects', valueJson: JSON.stringify([{ type: 'waves', amplitude: 1.5, freqZ: 8 }]) },
        ],
        summary: { fa: '', en: '' },
      },
      PRESETS,
    );
    expect(VaseParamsSchema.safeParse(params).success).toBe(true);
    expect(params.dimensions.height).toBe(300);
    expect(params.twist.total).toBe(45);
    expect(params.profile.preset).toBe('tulip');
    expect(params.effects).toHaveLength(1);
    expect(params.effects[0].type).toBe('waves');
    expect(params.dimensions.baseDiameter).toBe(PRESETS[0].params.dimensions.baseDiameter);
    expect(rejected).toEqual(['bogus.path']);
  });

  it('refine: JSON Patch applied atomically; failures keep the current design', () => {
    const cur = PRESETS[1].params;
    const ok = applyRefine(cur, {
      ops: [
        { op: 'replace', path: '/twist/total', from: null, valueJson: '160' },
        { op: 'replace', path: '/dimensions/neckDiameter', from: null, valueJson: '40' },
      ],
      summary: { fa: '', en: '' },
    });
    expect(ok.params.twist.total).toBe(160);
    expect(ok.rejected).toEqual([]);
    const bad = applyRefine(cur, {
      ops: [
        { op: 'replace', path: '/twist/total', from: null, valueJson: '10' },
        { op: 'remove', path: '/nope', from: null, valueJson: null },
      ],
      summary: { fa: '', en: '' },
    });
    expect(bad.params).toBe(cur);
    expect(bad.rejected).toHaveLength(1);
  });

  it('image analysis → custom profile, section, ribs, twist, colour', () => {
    const p = applyImageAnalysis(
      {
        heightToWidth: 1.6,
        profile: [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => ({ t, r: 0.6 + 0.4 * Math.sin(Math.PI * t) })),
        section: 'star',
        sides: 8,
        ribs: { count: 32, depthMm: 1.5, grooved: true, helixTurns: 0 },
        texture: null,
        twistDeg: 30,
        colorHex: '#a0522d',
        summary: { fa: '', en: '' },
      },
      PRESETS[0].params,
    );
    expect(p.profile.preset).toBe('custom');
    expect(p.profile.controlPoints[0].t).toBe(0);
    expect(p.profile.controlPoints.at(-1)!.t).toBe(100);
    expect(p.section.bottom.shape).toBe('star');
    expect(p.section.bottom.starPoints).toBe(8);
    expect(p.effects[0]).toMatchObject({ type: 'ribs', count: 32, style: 'grooved' });
    expect(p.render.color).toBe('#a0522d');
  });
});

describe('AI prompt and the tube insert', () => {
  it('lists the insert params and forbids changing them unasked', () => {
    const sys = designSystemPrompt(PRESETS);
    expect(sys).toContain('insert.od | number 10..150 mm');
    expect(sys).toContain('print.printer.holeCompensation');
    expect(refineSystemPrompt()).toMatch(/Never change insert\.\*/);
  });

  it('lists the six sleeve presets with their sleeve features, and the sleeve params with their meta', () => {
    const sys = designSystemPrompt(PRESETS);
    for (const id of ['molten', 'silk-drape', 'windswept', 'fingers', 'coral', 'drip'])
      expect(sys).toMatch(new RegExp(`^sleeve-${id}: .*; sleeve on (glass|steel) Ø\\d+`, 'm'));
    expect(sys).toMatch(/sleeve-fingers: .*6 fingers/);
    expect(sys).toMatch(/sleeve-coral: .*holes voronoi/);
    expect(sys).toContain('sleeve.fingers.freeLength | number 0..250 mm');
    expect(sys).toContain('sleeve.drips.placement | rim|fingers|random');
    expect(sys).toContain('sleeve.selfSupporting | bool');
    expect(sys).toContain('sleeve.holes.mode | none|organicNoise|ellipses|voronoi|foldGaps');
    expect(sys).toMatch(/keep the outputMode, insert\.\* and print\.printer\.\*/);
  });
});
