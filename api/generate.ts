import type { IncomingMessage, ServerResponse } from 'node:http';
import { depsFromEnv, handleGenerate } from '../server/http.js';

// Vercel serverless function: POST /api/generate
// The API key lives only in the function's environment, never in the bundle.
export default function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  return handleGenerate(req, res, depsFromEnv(process.env, { dev: false }));
}
