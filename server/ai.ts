/**
 * AI request handling (pure, client injected). The API key never leaves the server.
 * Model output is constrained to zod schemas via structured outputs; the browser re-validates
 * every change through the parameter schema, clamps, and runs auto-fix.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { z } from 'zod';
import {
  DesignProposal,
  ImageAnalysis,
  ImageRequest,
  ParamsRequest,
  RefinePatch,
  RefineRequest,
} from '../src/ai/schema';
import { designSystemPrompt, imageSystemPrompt, refineSystemPrompt } from '../src/ai/prompts';
import { PRESETS } from '../src/presets';

export const DEFAULT_MODEL = 'claude-opus-5-5';

export type Route = 'params' | 'refine' | 'image';

export interface AiError {
  code: 'bad_request' | 'not_configured' | 'rate_limited' | 'refused' | 'invalid_output' | 'upstream';
  message: { fa: string; en: string };
}

export type AiResult = { status: number; body: { ok: true; data: unknown; model: string } | { ok: false; error: AiError } };

const err = (status: number, code: AiError['code'], en: string, fa: string): AiResult => ({
  status,
  body: { ok: false, error: { code, message: { en, fa } } },
});

// System prompts are stable per process → cached by the API (prefix match).
const SYSTEM: Record<Route, string> = {
  params: designSystemPrompt(PRESETS),
  refine: refineSystemPrompt(),
  image: imageSystemPrompt(),
};

type ClientLike = Pick<Anthropic, 'beta'>;

async function call<S extends z.ZodType>(
  client: ClientLike,
  model: string,
  route: Route,
  schema: S,
  messages: Anthropic.Beta.BetaMessageParam[],
): Promise<AiResult> {
  const response = await client.beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: [{ type: 'text', text: SYSTEM[route], cache_control: { type: 'ephemeral' } }],
    output_config: { effort: 'medium', format: betaZodOutputFormat(schema) },
    messages,
  });
  if (response.stop_reason === 'refusal') {
    return err(422, 'refused', 'The model declined this request. Try rephrasing it.', 'مدل این درخواست را نپذیرفت؛ آن را طور دیگری بنویسید.');
  }
  if (response.parsed_output == null) {
    return err(502, 'invalid_output', 'The model returned an unexpected format. Please try again.', 'پاسخ مدل قالب درستی نداشت؛ دوباره تلاش کنید.');
  }
  return { status: 200, body: { ok: true, data: response.parsed_output, model: response.model } };
}

export async function handle(route: Route, rawBody: unknown, getClient: () => ClientLike, model = DEFAULT_MODEL): Promise<AiResult> {
  let client: ClientLike;
  try {
    client = getClient();
  } catch {
    return err(503, 'not_configured', 'AI is not configured on the server (set ANTHROPIC_API_KEY).', 'هوش مصنوعی روی سرور پیکربندی نشده است (ANTHROPIC_API_KEY).');
  }
  try {
    switch (route) {
      case 'params': {
        const req = ParamsRequest.safeParse(rawBody);
        if (!req.success) return err(400, 'bad_request', 'Invalid request.', 'درخواست نامعتبر است.');
        const text = `Design request (${req.data.lang === 'fa' ? 'Persian' : 'English'}):\n${req.data.prompt}`;
        return await call(client, model, 'params', DesignProposal, [{ role: 'user', content: text }]);
      }
      case 'refine': {
        const req = RefineRequest.safeParse(rawBody);
        if (!req.success) return err(400, 'bad_request', 'Invalid request.', 'درخواست نامعتبر است.');
        const history: Anthropic.Beta.BetaMessageParam[] = req.data.history.map((h) => ({ role: h.role, content: h.text }));
        const msg = `Current design JSON:\n${JSON.stringify(req.data.params)}\n\nRequest: ${req.data.message}`;
        return await call(client, model, 'refine', RefinePatch, [...history, { role: 'user', content: msg }]);
      }
      case 'image': {
        const req = ImageRequest.safeParse(rawBody);
        if (!req.success) return err(400, 'bad_request', 'Invalid image request.', 'تصویر نامعتبر است.');
        const { imageBase64, mediaType, note, silhouette } = req.data;
        const hint = silhouette
          ? `Measured silhouette (t, radius factor): ${silhouette.map((p) => `(${p.t.toFixed(2)}, ${p.r.toFixed(2)})`).join(' ')}`
          : 'No measured silhouette available.';
        return await call(client, model, 'image', ImageAnalysis, [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: `${hint}\n${note ? `User note: ${note}` : ''}` },
            ],
          },
        ]);
      }
    }
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      return err(503, 'not_configured', 'The server API key was rejected.', 'کلید API سرور پذیرفته نشد.');
    }
    if (e instanceof Anthropic.RateLimitError) {
      return err(429, 'rate_limited', 'The AI service is busy. Try again in a minute.', 'سرویس شلوغ است؛ یک دقیقهٔ دیگر تلاش کنید.');
    }
    if (e instanceof Anthropic.BadRequestError) {
      return err(400, 'bad_request', 'The AI service rejected the request.', 'سرویس هوش مصنوعی درخواست را نپذیرفت.');
    }
    if (e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError) {
      return err(502, 'upstream', 'The AI service is unavailable right now.', 'سرویس هوش مصنوعی در دسترس نیست.');
    }
    throw e;
  }
}
