import { AppError } from '../shared/errors.js';

/**
 * A single call to Gemini's generateContent REST endpoint.
 *
 * Deliberately uses fetch instead of an SDK: there is one endpoint, and
 * owning the call makes every failure explicit — timeout, abort, HTTP
 * status, safety block, truncated output — each mapped to an AppError.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface Turn {
  role: 'user' | 'model';
  text: string;
  /** Inline file (PDF/image) sent alongside the text. */
  inline?: { mimeType: string; data: string };
}

export interface GeminiCall {
  apiKey: string;
  model: string;
  system: string;
  turns: Turn[];
  schema: object;
  timeoutMs: number;
  /** Aborted when our own client disconnects – stops paying for unused work. */
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

export interface GeminiResult {
  text: string;
  finishReason?: string;
}

const BLOCK_REASONS = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

export async function callGemini(call: GeminiCall): Promise<GeminiResult> {
  const doFetch = call.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, call.timeoutMs);
  const onClientAbort = () => ctrl.abort();
  call.signal?.addEventListener('abort', onClientAbort, { once: true });

  try {
    let res: Response;
    let body: GeminiResponse;
    try {
      res = await doFetch(`${BASE_URL}/${encodeURIComponent(call.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': call.apiKey },
        signal: ctrl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.system }] },
          contents: call.turns.map((t) => ({
            role: t.role,
            parts: [...(t.inline ? [{ inlineData: { mimeType: t.inline.mimeType, data: t.inline.data } }] : []), { text: t.text }],
          })),
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: call.schema,
            temperature: 0.6,
            maxOutputTokens: 8192,
          },
        }),
      });
      body = (await res.json().catch(() => ({}))) as GeminiResponse;
    } catch (e) {
      if (timedOut) throw new AppError('TIMEOUT', `The model (${call.model}) took too long to respond.`);
      if (call.signal?.aborted) throw new AppError('ABORTED', 'Request was cancelled.');
      throw new AppError('UPSTREAM', `Could not reach the AI provider: ${(e as Error).message}`);
    }

    if (!res.ok) throw mapHttpError(res.status, body.error?.message, call.model);

    if (body.promptFeedback?.blockReason) {
      throw new AppError('BLOCKED', 'The AI provider declined this input. Try rephrasing your notes.');
    }
    const candidate = body.candidates?.[0];
    if (!candidate) throw new AppError('UPSTREAM', 'The AI provider returned no result.');
    if (candidate.finishReason && BLOCK_REASONS.has(candidate.finishReason)) {
      throw new AppError('BLOCKED', 'The AI provider stopped generating for safety reasons. Try different input.');
    }

    // Thinking models may include "thought" parts; only the answer parts are JSON.
    const text = (candidate.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    return { text, finishReason: candidate.finishReason };
  } finally {
    clearTimeout(timer);
    call.signal?.removeEventListener('abort', onClientAbort);
  }
}

function mapHttpError(status: number, providerMessage: string | undefined, model: string): AppError {
  // Provider messages are logged server-side but not echoed verbatim to users.
  if (providerMessage) console.warn(`[gemini] ${model} HTTP ${status}: ${providerMessage}`);
  if (status === 429) return new AppError('RATE_LIMITED', 'The AI provider is rate-limiting requests. Wait a moment and retry.');
  if (status === 401 || status === 403) return new AppError('CONFIG', 'The server’s AI API key was rejected.');
  if (status === 404) return new AppError('UPSTREAM', `Model "${model}" is not available.`, false);
  if (status >= 500) return new AppError('UPSTREAM', 'The AI provider had an internal error.');
  return new AppError('UPSTREAM', `The AI provider rejected the request (HTTP ${status}).`, false);
}
