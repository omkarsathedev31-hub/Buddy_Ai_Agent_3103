import type { Request, Response } from 'express';
import { createApp } from './app.ts';
import { DatabaseConfigError } from './db.ts';

type ExpressHandler = (req: Request, res: Response) => unknown;

let cachedApp: ExpressHandler | null = null;

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === 'string') {
    const trimmed = value.split(',')[0]?.trim();
    return trimmed || null;
  }
  if (Array.isArray(value) && value.length > 0) {
    const trimmed = String(value[0]).split(',')[0]?.trim();
    return trimmed || null;
  }
  return null;
}

/**
 * Restores the original `/api/...` route path when Vercel rewrites `/api/(.*)`
 * to `/api/index.mjs?__buddy_path=$1` (or `/api` to `/api/index.mjs`), while
 * preserving all other query parameters.
 */
export function normalizeVercelRequestUrl(
  rawUrl: string | undefined,
  headers: Record<string, string | string[] | undefined> = {}
): string {
  const input = rawUrl || '/';
  let parsed: URL;
  try {
    parsed = new URL(input, 'http://localhost');
  } catch {
    return input;
  }

  if (parsed.searchParams.has('__buddy_path')) {
    const rawSub = parsed.searchParams.get('__buddy_path') ?? '';
    parsed.searchParams.delete('__buddy_path');
    const cleanSub = rawSub.replace(/^\/+/, '');
    const targetPath = cleanSub ? `/api/${cleanSub}` : '/api';
    const qs = parsed.searchParams.toString();
    return qs ? `${targetPath}?${qs}` : targetPath;
  }

  if (
    parsed.pathname === '/api/index' ||
    parsed.pathname === '/api/index.mjs' ||
    parsed.pathname === '/api/index.ts'
  ) {
    const forwarded =
      firstHeaderValue(headers['x-vercel-forwarded-path']) ||
      firstHeaderValue(headers['x-forwarded-uri']) ||
      firstHeaderValue(headers['x-rewrite-url']);

    let targetPath = '/api';
    if (forwarded && forwarded.startsWith('/api')) {
      const forwardedPath = forwarded.split('?')[0];
      if (
        forwardedPath &&
        forwardedPath !== '/api/index' &&
        forwardedPath !== '/api/index.mjs' &&
        forwardedPath !== '/api/index.ts'
      ) {
        targetPath = forwardedPath;
      }
    }

    const qs = parsed.searchParams.toString();
    return qs ? `${targetPath}?${qs}` : targetPath;
  }

  return input;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  try {
    req.url = normalizeVercelRequestUrl(req.url, req.headers as Record<string, string | string[] | undefined>);

    if (!cachedApp) {
      cachedApp = createApp();
    }

    const app = cachedApp;
    await new Promise<void>((resolve) => {
      if (res.writableEnded) {
        resolve();
        return;
      }
      const done = () => {
        res.off('finish', done);
        res.off('close', done);
        resolve();
      };
      res.on('finish', done);
      res.on('close', done);
      app(req, res);
    });
  } catch (err) {
    const isDbConfigErr = err instanceof DatabaseConfigError;
    const message = err instanceof Error ? err.message : 'Server initialization failed.';
    console.error('[Buddy Elder AI Vercel Handler Error]', {
      code: isDbConfigErr ? err.code : 'SERVER_INIT_ERROR',
      message,
    });
    if (!res.headersSent) {
      res.statusCode = isDbConfigErr ? 503 : 500;
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          code: isDbConfigErr ? err.code : 'SERVER_INIT_ERROR',
          error: {
            code: isDbConfigErr ? err.code : 'SERVER_INIT_ERROR',
            message:
              isDbConfigErr || process.env.NODE_ENV !== 'production'
                ? message
                : 'Backend server initialization failed. Check server runtime and environment variables.',
          },
        })
      );
    }
  }
}
