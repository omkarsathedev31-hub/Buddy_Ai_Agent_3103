import './server/env.ts';
import { getGeminiKeyInfo, isJwtSecretConfiguredInEnv, validateGeminiStartupConfig } from './server/env.ts';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { warmUpGeminiModelDiscovery } from './server/ai.ts';
import { createApp } from './server/app.ts';
import { closeDb, getDatabaseStatus, getDbPath } from './server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;
  const isProd = process.env.NODE_ENV === 'production';

  const apiFallback404: express.RequestHandler = (_req, res) => {
    res.status(404).json({
      success: false,
      code: 'NOT_FOUND',
      error: 'API endpoint not found.',
    });
  };

  if (!isProd) {
    app.use('/api', apiFallback404);
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use('/api', apiFallback404);
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) {
        res.status(404).json({
          success: false,
          code: 'NOT_FOUND',
          error: 'API endpoint not found.',
        });
        return;
      }
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const httpServer = app.listen(PORT, '0.0.0.0', () => {
    const dbMeta = app.locals.buddyMeta as
      | { dbMode?: string; aiConfigured?: boolean; messagingConfigured?: boolean }
      | undefined;
    const dbStatus = getDatabaseStatus();
    console.log(
      `Buddy Elder AI server running on http://0.0.0.0:${PORT} (${isProd ? 'production' : 'development'})`,
      {
        ...(dbMeta ?? {}),
        dbDurable: dbStatus.durable,
        dbPath: getDbPath(),
        aiKeySource: getGeminiKeyInfo().source,
      }
    );
    const keyInfo = getGeminiKeyInfo();
    const aiStartup = validateGeminiStartupConfig();
    const jwtSecretConfigured = isJwtSecretConfiguredInEnv();
    console.log('AI Provider: Gemini');
    console.log(`AI Configuration: ${keyInfo.configured ? `Configured (${keyInfo.varName})` : 'NOT CONFIGURED'}`);
    if (!aiStartup.configured) {
      console.warn(`[Buddy AI Startup Validation] ${aiStartup.message}`);
    } else if (!aiStartup.valid) {
      console.warn(`[Buddy AI Startup Validation] ${aiStartup.message}`);
    } else {
      console.log(`[Buddy AI Startup Validation] ${aiStartup.message}`);
    }
    if (jwtSecretConfigured) {
      console.log('[Buddy Auth Startup] JWT signing secret loaded from environment (HS256).');
    } else if (isProd) {
      console.warn(
        '[Buddy Auth Startup] WARNING: JWT_SECRET environment variable is missing or shorter than 16 chars; ' +
          'using a per-process ephemeral secret, which will invalidate active JWTs across server restarts.'
      );
    } else {
      console.log('[Buddy Auth Startup] JWT signing using per-process ephemeral secret (development mode).');
    }
    if (aiStartup.configured && aiStartup.valid) {
      void warmUpGeminiModelDiscovery().then((models) => {
        if (models.length > 0) {
          console.log(`[Buddy AI Startup Discovery] Verified ${models.length} chat model(s); top: ${models.slice(0, 4).join(', ')}`);
        }
      });
    }
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Buddy Elder AI] Received ${signal}. Closing server and checkpointing database...`);
    const forceTimer = setTimeout(() => {
      closeDb();
      process.exit(1);
    }, 5000);
    forceTimer.unref();

    httpServer.close(() => {
      clearTimeout(forceTimer);
      closeDb();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Stop the conflicting process or set PORT to another free port.`);
    } else if (err.code === 'EACCES') {
      console.error(`Permission denied binding to port ${PORT}. Try PORT=3000 or check OS firewall permissions.`);
    } else {
      console.error('Buddy Elder AI server error:', err.message);
    }
    closeDb();
    process.exit(1);
  });
}

export { createApp };

const isVercel = process.env.VERCEL === '1' || process.env.VERCEL === 'true' || Boolean(process.env.VERCEL_ENV);

if (!isVercel) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err instanceof Error ? err.message : err);
    closeDb();
    process.exit(1);
  });
}
