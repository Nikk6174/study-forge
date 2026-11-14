import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { depsFromEnv, handleGenerate } from './server/http.js';

/**
 * Mounts the same handler the Vercel function uses at /api/generate, so
 * `npm run dev` is one process and the API key never reaches the client.
 * (loadEnv with prefix '' reads GEMINI_API_KEY from .env on the Node side
 * only; Vite exposes just VITE_* vars to the browser.)
 */
function apiPlugin(env: Record<string, string>): Plugin {
  const deps = depsFromEnv({ ...process.env, ...env }, { dev: true });
  const mount = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use('/api/generate', (req, res) => void handleGenerate(req, res, deps));
  };
  return {
    name: 'local-api',
    configureServer: mount,
    configurePreviewServer: mount,
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), apiPlugin(loadEnv(mode, process.cwd(), ''))],
  server: { port: 5173 },
}));
