/**
 * VaseForge AI proxy. Run: ANTHROPIC_API_KEY=… npm run server
 * Endpoints (JSON only): POST /api/ai/params | /api/ai/refine | /api/ai/image, GET /api/ai/health
 */
import Anthropic from '@anthropic-ai/sdk';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DEFAULT_MODEL, handle, type Route } from './ai';

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.VASEFORGE_MODEL ?? DEFAULT_MODEL;
const ORIGIN = process.env.ALLOWED_ORIGIN ?? '';
const MAX_BODY = 8 * 1024 * 1024;
const RATE = { capacity: 20, refillPerMin: 4 }; // per IP

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 120_000 }));

const buckets = new Map<string, { tokens: number; at: number }>();
function allow(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip) ?? { tokens: RATE.capacity, at: now };
  b.tokens = Math.min(RATE.capacity, b.tokens + ((now - b.at) / 60_000) * RATE.refillPerMin);
  b.at = now;
  if (b.tokens < 1) {
    buckets.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(ip, b);
  return true;
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(ORIGIN ? { 'access-control-allow-origin': ORIGIN, vary: 'origin' } : {}),
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error('too_large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const ROUTES: Record<string, Route> = { '/api/ai/params': 'params', '/api/ai/refine': 'refine', '/api/ai/image': 'image' };

createServer(async (req, res) => {
  const url = (req.url ?? '').split('?')[0];
  if (req.method === 'OPTIONS' && ORIGIN) {
    res.writeHead(204, {
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-methods': 'POST, GET',
      'access-control-allow-headers': 'content-type',
    });
    return res.end();
  }
  if (req.method === 'GET' && url === '/api/ai/health') {
    return send(res, 200, { ok: true, configured: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN), model: MODEL });
  }
  const route = ROUTES[url];
  if (req.method !== 'POST' || !route) return send(res, 404, { ok: false, error: { code: 'not_found' } });
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || req.socket.remoteAddress || '?';
  if (!allow(ip)) {
    return send(res, 429, {
      ok: false,
      error: { code: 'rate_limited', message: { en: 'Too many requests. Wait a minute.', fa: 'درخواست‌ها زیاد است؛ کمی صبر کنید.' } },
    });
  }
  let body: unknown;
  try {
    body = await readJson(req);
  } catch (e) {
    const big = (e as Error).message === 'too_large';
    return send(res, big ? 413 : 400, {
      ok: false,
      error: { code: 'bad_request', message: { en: big ? 'Request too large.' : 'Invalid JSON.', fa: big ? 'درخواست خیلی بزرگ است.' : 'JSON نامعتبر.' } },
    });
  }
  try {
    const r = await handle(route, body, getClient, MODEL);
    send(res, r.status, r.body);
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: { code: 'upstream', message: { en: 'Server error.', fa: 'خطای سرور.' } } });
  }
}).listen(PORT, () => console.log(`VaseForge AI proxy on :${PORT} (model ${MODEL})`));
