import type { IncomingMessage, ServerResponse } from 'node:http';
import { AppError } from '../shared/errors.js';
import { generate, type GenerateDeps } from './generate.js';

/**
 * Node (req, res) adapter used by BOTH the Vite dev middleware and the
 * Vercel serverless function, so local dev runs exactly the production code.
 */

const MAX_BODY_BYTES = 200_000;
const DEFAULT_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash'];

export function depsFromEnv(env: Record<string, string | undefined>, opts: { dev: boolean }): GenerateDeps {
  const models = (env.GEMINI_MODELS ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
  return {
    apiKey: env.GEMINI_API_KEY,
    models: models.length ? models : DEFAULT_MODELS,
    allowSimulate: opts.dev || env.ALLOW_SIMULATE === 'true',
  };
}

async function readJsonBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  // Vercel pre-parses JSON bodies; the Vite dev server does not.
  if (req.body !== undefined) {
    if (typeof req.body !== 'string') return req.body;
    return parseJson(req.body);
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new AppError('INVALID_INPUT', 'Request is too large.');
    chunks.push(chunk as Buffer);
  }
  return parseJson(Buffer.concat(chunks).toString('utf8'));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('INVALID_INPUT', 'Request body must be JSON.');
  }
}

function send(res: ServerResponse, status: number, payload: unknown) {
  if (res.writableEnded || res.destroyed) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export async function handleGenerate(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
  deps: GenerateDeps,
): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, new AppError('INVALID_INPUT', 'Use POST.').toBody());
  }

  // If the browser goes away (user cancelled / navigated / sent a newer
  // request), abort the upstream model call instead of finishing it.
  const ctrl = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ctrl.abort();
  });

  const started = Date.now();
  try {
    const body = await readJsonBody(req);
    const result = await generate(body, deps, ctrl.signal);
    console.info(`[generate] ok model=${result.meta.model} attempts=${result.meta.attempts} ms=${result.meta.ms}`);
    send(res, 200, result);
  } catch (e) {
    const err =
      e instanceof AppError ? e : new AppError('UPSTREAM', 'Unexpected server error.', true);
    if (!(e instanceof AppError)) console.error('[generate] unexpected', e);
    console.info(`[generate] fail code=${err.code} ms=${Date.now() - started}`);
    send(res, err.status, err.toBody());
  }
}
