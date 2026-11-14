import { z } from 'zod';
import { AppError, type ErrorCode } from '../shared/errors.js';
import { OutputError, normalizeStudySet, parseModelOutput, type NormalizeOptions } from '../shared/normalize.js';
import { ATTACHMENT_MIME_TYPES, LIMITS, SIMULATE_MODES, type GenerateRequest, type GenerateResponse } from '../shared/types.js';
import { callGemini, type GeminiResult, type Turn } from './gemini.js';
import { RESPONSE_SCHEMA, SYSTEM_PROMPT, buildGeneratePrompt, buildRefinePrompt, buildRepairPrompt } from './prompt.js';
import { simulate } from './simulate.js';

/**
 * Request pipeline:
 *
 *   validate input ─► call model ─► parse + validate output ─► respond
 *                        │                 │
 *                        │                 └─ invalid? one repair turn with the
 *                        │                    exact problems, same model
 *                        └─ timeout / 429 / 5xx / still invalid?
 *                           fall back to the next model in the chain
 *
 * All of it runs under one total deadline, so the client gets a typed
 * answer before its own timeout instead of an opaque gateway error.
 */

export interface GenerateDeps {
  apiKey?: string;
  models: string[];
  allowSimulate: boolean;
  totalBudgetMs?: number;
  perCallTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const TOTAL_BUDGET_MS = 45_000;
const PER_CALL_TIMEOUT_MS = 25_000;
const MIN_USEFUL_MS = 3_000; // don't start an attempt that can't finish
const FALLBACK_ON: ErrorCode[] = ['TIMEOUT', 'RATE_LIMITED', 'UPSTREAM', 'BAD_OUTPUT'];

const MAX_BASE64 = Math.ceil(LIMITS.attachmentMaxBytes / 3) * 4;

const RequestSchema = z
  .object({
    text: z
      .string()
      .trim()
      .max(LIMITS.textMax, `Notes are too long (max ${LIMITS.textMax.toLocaleString()} characters).`)
      .default(''),
    mode: z.enum(['flashcards', 'quiz', 'both']),
    count: z.coerce
      .number()
      .int()
      .min(LIMITS.countMin, `Choose at least ${LIMITS.countMin} items.`)
      .max(LIMITS.countMax, `Choose at most ${LIMITS.countMax} items.`),
    refine: z
      .object({
        set: z.unknown(),
        instruction: z.string().trim().min(1, 'Describe the change you want.').max(LIMITS.instructionMax),
      })
      .optional(),
    simulate: z.enum(SIMULATE_MODES).optional(),
    attachment: z
      .object({
        name: z.string().trim().min(1).max(200),
        mimeType: z.enum(ATTACHMENT_MIME_TYPES, { message: 'That file type isn’t supported. Use a PDF or an image.' }),
        data: z
          .string()
          .min(1, 'The attached file is empty.')
          .max(MAX_BASE64, `File is too large (max ${LIMITS.attachmentMaxBytes / 1024 / 1024} MB).`)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'The attached file data is corrupted.'),
      })
      .optional(),
  })
  // Text is required unless there's a file to study from, or we're refining an existing set.
  .superRefine((r, ctx) => {
    if (!r.refine && !r.attachment && r.text.length < LIMITS.textMin) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: r.text ? 'Enter at least a few characters.' : 'Enter some notes or a topic, or attach a file.',
      });
    }
  });

export function parseRequest(body: unknown): GenerateRequest {
  const r = RequestSchema.safeParse(body);
  if (!r.success) throw new AppError('INVALID_INPUT', r.error.issues[0]?.message ?? 'Invalid request.');
  const req = r.data as GenerateRequest;
  if (req.refine) delete req.attachment; // refinement works from the existing set
  if (req.refine) {
    // The set comes from the browser (localStorage) – revalidate it.
    try {
      req.refine.set = normalizeStudySet(req.refine.set, { mode: 'both' }).set;
    } catch {
      throw new AppError('INVALID_INPUT', 'The study set to refine is invalid. Generate a new one.');
    }
  }
  return req;
}

export async function generate(body: unknown, deps: GenerateDeps, signal?: AbortSignal): Promise<GenerateResponse> {
  const started = Date.now();
  const req = parseRequest(body);
  const deadline = started + (deps.totalBudgetMs ?? TOTAL_BUDGET_MS);
  const remaining = () => deadline - Date.now();

  // Refinement can add or remove items and switch between cards/quiz, so it
  // is validated against both lists without a fixed count.
  const normalizeOpts: NormalizeOptions = req.refine ? { mode: 'both' } : { mode: req.mode, count: req.count };

  if (req.simulate) {
    if (!deps.allowSimulate) throw new AppError('INVALID_INPUT', 'Failure simulation is disabled on this server.');
    const raw = await simulate(req.simulate, signal);
    const { set, warnings } = parseModelOutput(raw, normalizeOpts);
    return { set, warnings, meta: { model: `simulated:${req.simulate}`, attempts: 1, ms: Date.now() - started, repaired: false } };
  }

  if (!deps.apiKey) throw new AppError('CONFIG', 'The server has no AI API key configured.');
  if (deps.models.length === 0) throw new AppError('CONFIG', 'No AI model configured.');

  const prompt = req.refine
    ? buildRefinePrompt(req.text, req.refine.set, req.refine.instruction)
    : buildGeneratePrompt(req.text, req.mode, req.count, req.attachment?.name);

  let attempts = 0;
  let lastError: unknown;

  const ask = async (model: string, turns: Turn[]): Promise<GeminiResult> => {
    if (remaining() < MIN_USEFUL_MS) throw new AppError('TIMEOUT', 'The AI took too long to respond.');
    attempts++;
    return callGemini({
      apiKey: deps.apiKey!,
      model,
      system: SYSTEM_PROMPT,
      turns,
      schema: RESPONSE_SCHEMA,
      timeoutMs: Math.min(deps.perCallTimeoutMs ?? PER_CALL_TIMEOUT_MS, remaining()),
      signal,
      fetchImpl: deps.fetchImpl,
    });
  };

  for (const model of deps.models) {
    // The file rides on the first user turn, so a repair turn still has it in context.
    const turns: Turn[] = [{ role: 'user', text: prompt, inline: req.attachment }];
    try {
      const first = await ask(model, turns);
      try {
        return done(parseModelOutput(first.text, normalizeOpts), model, false);
      } catch (e) {
        // Empty is a legitimate answer ("nothing to study") – don't argue with it.
        if (!(e instanceof OutputError) || e.code === 'EMPTY_OUTPUT') throw e;
        const truncated = first.finishReason === 'MAX_TOKENS';
        console.warn(`[generate] ${model} bad output (${truncated ? 'truncated' : 'invalid'}), repairing: ${e.detail.slice(0, 200)}`);
        const problem = truncated
          ? 'Your reply was cut off because it was too long. Use shorter answers so the complete JSON fits.'
          : e.detail;
        const second = await ask(model, [
          ...turns,
          { role: 'model', text: first.text.slice(0, 8000) },
          { role: 'user', text: buildRepairPrompt(problem) },
        ]);
        return done(parseModelOutput(second.text, normalizeOpts), model, true);
      }
    } catch (e) {
      if (signal?.aborted) throw new AppError('ABORTED', 'Request was cancelled.');
      lastError = e;
      const code = e instanceof AppError ? e.code : undefined;
      if (code && FALLBACK_ON.includes(code) && remaining() > MIN_USEFUL_MS) {
        console.warn(`[generate] ${model} failed with ${code}; trying next model`);
        continue;
      }
      throw e;
    }
  }
  throw lastError ?? new AppError('UPSTREAM', 'All AI models failed.');

  function done(result: ReturnType<typeof parseModelOutput>, model: string, repaired: boolean): GenerateResponse {
    const warnings = repaired ? ['The first AI response was invalid and was automatically repaired.', ...result.warnings] : result.warnings;
    return { set: result.set, warnings, meta: { model, attempts, ms: Date.now() - started, repaired } };
  }
}
