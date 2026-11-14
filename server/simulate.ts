import { AppError } from '../shared/errors.js';
import type { SimulateMode } from '../shared/types.js';

/**
 * Failure injection for demoing/testing the unhappy paths without waiting
 * for the model to misbehave. Simulated *text* is fed through the exact same
 * parse/validate pipeline as real model output, so this exercises real code,
 * not a mocked UI state. Enabled only in local dev or with ALLOW_SIMULATE=true.
 */

const sample = {
  title: 'The Water Cycle',
  flashcards: [
    { front: 'What is evaporation?', back: 'Liquid water turning into water vapour, mostly driven by solar heat.' },
    { front: 'What is condensation?', back: 'Water vapour cooling into liquid droplets, forming clouds.' },
    { front: 'What is precipitation?', back: 'Water falling from clouds as rain, snow, sleet or hail.' },
    { front: 'What is transpiration?', back: 'Water vapour released from plant leaves.' },
  ],
  questions: [
    {
      prompt: 'Which process forms clouds?',
      options: ['Evaporation', 'Condensation', 'Infiltration', 'Runoff'],
      correctIndex: 1,
      explanation: 'Clouds form when water vapour cools and condenses into droplets.',
    },
    {
      prompt: 'What mainly drives evaporation?',
      options: ['The Moon', 'Wind only', 'Solar energy', 'Gravity'],
      correctIndex: 2,
      explanation: 'The Sun’s heat supplies the energy for liquid water to become vapour.',
    },
    {
      prompt: 'Transpiration releases water vapour from plants.',
      options: ['True', 'False'],
      correctIndex: 0,
      explanation: 'Plants release water vapour through stomata in their leaves.',
    },
  ],
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AppError('ABORTED', 'Request was cancelled.'));
    });
  });

/** Returns raw "model" text, or throws the same errors the real client would. */
export async function simulate(mode: SimulateMode, signal?: AbortSignal): Promise<string> {
  await sleep(mode === 'slow' ? 15_000 : 900, signal);
  switch (mode) {
    case 'malformed':
      // Truncated mid-object, like a response cut off by maxOutputTokens.
      return 'Sure! Here are your flashcards:\n```json\n{"title": "The Water Cycle", "flashcards": [{"front": "What is evap';
    case 'wrong_shape':
      return JSON.stringify({ answer: 'The water cycle is how water moves around Earth.', confidence: 0.9 });
    case 'partial':
      return JSON.stringify({
        ...sample,
        flashcards: [...sample.flashcards, { front: '', back: 'orphan answer' }, { front: 'No back' }],
        questions: [
          ...sample.questions,
          { prompt: 'Broken question', options: ['A', 'B'], correctIndex: 7 },
          { prompt: 'Which is a gas?', options: ['Ice', 'Ice'], correctIndex: 0 },
        ],
      });
    case 'empty':
      return JSON.stringify({ title: '', notice: 'That input doesn’t contain anything to study.', flashcards: [], questions: [] });
    case 'slow':
      return JSON.stringify(sample);
    case 'upstream_error':
      throw new AppError('UPSTREAM', 'The AI provider had an internal error. (simulated)');
    case 'rate_limit':
      throw new AppError('RATE_LIMITED', 'The AI provider is rate-limiting requests. (simulated)');
  }
}
