import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { apiRouter } from './server/routes.js';

// Load environment variables from .env if present
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT || '3000', 10);
const isProduction = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();

  // Basic request parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Mount backend API routes
  app.use('/api', apiRouter);

  if (!isProduction) {
    // Development mode: Mount Vite dev server middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });

    app.use(vite.middlewares);
    console.log('[JARVIS Server] Vite development middleware attached.');
  } else {
    // Production mode: Serve pre-built static bundle
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));

    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
    console.log('[JARVIS Server] Production static assets mounted from dist.');
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[JARVIS Server] Running on http://0.0.0.0:${PORT} in ${isProduction ? 'production' : 'development'} mode.`);
  });

  return { app, server };
}

// Start server if executed directly
if (process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('[JARVIS Server] Startup failure:', err);
    process.exit(1);
  });
}

export { startServer };
