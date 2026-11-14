import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../shared/errors.js';
import { generate, type GenerateDeps } from './generate.js';

const validSet = JSON.stringify({
  title: 'T',
  flashcards: [
    { front: 'a', back: 'b' },
    { front: 'c', back: 'd' },
    { front: 'e', back: 'f' },
  ],
  questions: [],
});

const geminiOk = (text: string, finishReason = 'STOP') =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }), { status: 200 });

/** fetch stub that plays back a script of responses and records model + body per call. */
function scripted(...steps: (Response | Error | 'hang')[]) {
  const calls: { model: string; body: any }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ model: String(url).split('/models/')[1]!.split(':')[0]!, body: JSON.parse(String(init?.body)) });
    const step = steps.shift();
    if (!step) throw new Error('unexpected extra call');
    if (step === 'hang') {
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
      );
    }
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const deps = (fetchImpl: typeof fetch, extra: Partial<GenerateDeps> = {}): GenerateDeps => ({
  apiKey: 'test',
  models: ['primary', 'fallback'],
  allowSimulate: true,
  fetchImpl,
  ...extra,
});

const body = { text: 'Photosynthesis notes', mode: 'flashcards', count: 3 };

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
};

describe('generate', () => {
  it('returns a normalised set on the happy path', async () => {
    const { fetchImpl, calls } = scripted(geminiOk(validSet));
    const res = await generate(body, deps(fetchImpl));
    expect(res.set.flashcards).toHaveLength(3);
    expect(res.meta).toMatchObject({ model: 'primary', attempts: 1, repaired: false });
    expect(calls[0]!.body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('repairs malformed output with one follow-up turn that includes the problem', async () => {
    const { fetchImpl, calls } = scripted(geminiOk('{"title": "T", "flashcards": [{"fro'), geminiOk(validSet));
    const res = await generate(body, deps(fetchImpl));
    expect(res.meta).toMatchObject({ model: 'primary', attempts: 2, repaired: true });
    expect(res.warnings[0]).toMatch(/repaired/);
    const repairTurns = calls[1]!.body.contents;
    expect(repairTurns.map((t: any) => t.role)).toEqual(['user', 'model', 'user']);
    expect(repairTurns[2].parts[0].text).toMatch(/not valid JSON/);
  });

  it('falls back to the next model when repair also fails', async () => {
    const { fetchImpl, calls } = scripted(geminiOk('nope'), geminiOk('still nope'), geminiOk(validSet));
    const res = await generate(body, deps(fetchImpl));
    expect(calls.map((c) => c.model)).toEqual(['primary', 'primary', 'fallback']);
    expect(res.meta.model).toBe('fallback');
  });

  it('falls back on 5xx and 429', async () => {
    const { fetchImpl } = scripted(new Response('{}', { status: 503 }), geminiOk(validSet));
    expect((await generate(body, deps(fetchImpl))).meta.model).toBe('fallback');
    const rl = scripted(new Response('{}', { status: 429 }), new Response('{}', { status: 429 }));
    await rejectsWith(generate(body, deps(rl.fetchImpl)), 'RATE_LIMITED');
  });

  it('times out a hanging model and falls back', async () => {
    const { fetchImpl } = scripted('hang', geminiOk(validSet));
    const res = await generate(body, deps(fetchImpl, { perCallTimeoutMs: 50 }));
    expect(res.meta.model).toBe('fallback');
  });

  it('reports TIMEOUT when every model hangs', async () => {
    const { fetchImpl } = scripted('hang', 'hang');
    await rejectsWith(generate(body, deps(fetchImpl, { perCallTimeoutMs: 50, totalBudgetMs: 3_200 })), 'TIMEOUT');
  });

  it('does not repair or fall back on a genuine empty answer', async () => {
    const { fetchImpl, calls } = scripted(
      geminiOk(JSON.stringify({ title: '', notice: 'Not studyable', flashcards: [], questions: [] })),
    );
    await rejectsWith(generate(body, deps(fetchImpl)), 'EMPTY_OUTPUT');
    expect(calls).toHaveLength(1);
  });

  it('maps safety blocks and rejected keys without falling back', async () => {
    const blocked = scripted(new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }));
    await rejectsWith(generate(body, deps(blocked.fetchImpl)), 'BLOCKED');
    const badKey = scripted(new Response('{}', { status: 403 }));
    await rejectsWith(generate(body, deps(badKey.fetchImpl)), 'CONFIG');
    expect(badKey.calls).toHaveLength(1);
  });

  it('stops immediately when the client aborts', async () => {
    const { fetchImpl, calls } = scripted('hang', geminiOk(validSet));
    const ctrl = new AbortController();
    const p = generate(body, deps(fetchImpl), ctrl.signal);
    setTimeout(() => ctrl.abort(), 20);
    await rejectsWith(p, 'ABORTED');
    expect(calls).toHaveLength(1);
  });

  it('validates input before calling the model', async () => {
    const { fetchImpl, calls } = scripted();
    await rejectsWith(generate({ ...body, text: ' ' }, deps(fetchImpl)), 'INVALID_INPUT');
    await rejectsWith(generate({ ...body, count: 999 }, deps(fetchImpl)), 'INVALID_INPUT');
    await rejectsWith(generate({ ...body, refine: { set: { junk: true }, instruction: 'x' } }, deps(fetchImpl)), 'INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('requires an API key', async () => {
    const { fetchImpl } = scripted();
    await rejectsWith(generate(body, deps(fetchImpl, { apiKey: undefined })), 'CONFIG');
  });

  it('runs simulated output through the real parser', async () => {
    const { fetchImpl } = scripted();
    const partial = await generate({ ...body, mode: 'both', simulate: 'partial' }, deps(fetchImpl));
    expect(partial.warnings.join(' ')).toMatch(/Skipped 4/);
    await rejectsWith(generate({ ...body, simulate: 'malformed' }, deps(fetchImpl)), 'BAD_OUTPUT');
    await rejectsWith(generate({ ...body, simulate: 'wrong_shape' }, deps(fetchImpl)), 'BAD_OUTPUT');
    await rejectsWith(generate({ ...body, simulate: 'empty' }, deps(fetchImpl, { allowSimulate: false })), 'INVALID_INPUT');
  });
});
