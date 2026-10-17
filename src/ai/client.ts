import type { I18nText } from '../core/params/schema';
import type { DesignProposal, ImageAnalysis, RefinePatch } from './schema';

export interface AiFailure {
  code: string;
  message: I18nText;
}
export type AiResponse<T> = { ok: true; data: T; model: string } | { ok: false; error: AiFailure };

const UNREACHABLE: AiFailure = {
  code: 'unreachable',
  message: {
    en: 'The AI server is not reachable. Start it with `npm run server` (needs ANTHROPIC_API_KEY).',
    fa: 'سرور هوش مصنوعی در دسترس نیست. آن را با `npm run server` اجرا کنید (نیازمند ANTHROPIC_API_KEY).',
  },
};

async function post<T>(route: string, body: unknown): Promise<AiResponse<T>> {
  try {
    const res = await fetch(`/api/ai/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as AiResponse<T> | null;
    if (!json || typeof json !== 'object' || !('ok' in json)) return { ok: false, error: UNREACHABLE };
    return json;
  } catch {
    return { ok: false, error: UNREACHABLE };
  }
}

export const aiDesign = (prompt: string, lang: 'fa' | 'en') => post<DesignProposal>('params', { prompt, lang });
export const aiRefine = (params: unknown, message: string, history: { role: 'user' | 'assistant'; text: string }[]) =>
  post<RefinePatch>('refine', { params, message, history });
export const aiImage = (
  imageBase64: string,
  mediaType: string,
  note: string,
  silhouette: { t: number; r: number }[] | null,
) => post<ImageAnalysis>('image', { imageBase64, mediaType, note, silhouette });

export async function aiHealth(): Promise<{ reachable: boolean; configured: boolean; model?: string }> {
  try {
    const r = await fetch('/api/ai/health');
    if (!r.ok) return { reachable: false, configured: false };
    const j = (await r.json()) as { configured: boolean; model: string };
    return { reachable: true, configured: j.configured, model: j.model };
  } catch {
    return { reachable: false, configured: false };
  }
}
