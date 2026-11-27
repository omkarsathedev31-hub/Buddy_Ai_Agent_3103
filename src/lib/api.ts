export interface SavedErrorUserMessage {
  id: string;
  conversation_id?: string;
  role: 'user' | 'assistant';
  content: string;
  language: string;
  created_at: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  retryAfterSeconds?: number;
  rateLimitSource?: string;
  quotaExhausted?: boolean;
  userMessageSaved?: boolean;
  userMessage?: SavedErrorUserMessage;
  model?: string;
  fallbackAttempted?: boolean;
  attemptedModels?: string[];

  constructor(
    message: string,
    status: number,
    code?: string,
    meta?: {
      retryAfterSeconds?: number;
      rateLimitSource?: string;
      quotaExhausted?: boolean;
      userMessageSaved?: boolean;
      userMessage?: SavedErrorUserMessage;
      model?: string;
      fallbackAttempted?: boolean;
      attemptedModels?: string[];
    }
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfterSeconds = meta?.retryAfterSeconds;
    this.rateLimitSource = meta?.rateLimitSource;
    this.quotaExhausted = meta?.quotaExhausted;
    this.userMessageSaved = meta?.userMessageSaved;
    this.userMessage = meta?.userMessage;
    this.model = meta?.model;
    this.fallbackAttempted = meta?.fallbackAttempted;
    this.attemptedModels = meta?.attemptedModels;
  }
}

let memoryAuthToken: string | null = null;
let authGeneration = 0;
let onUnauthorizedHandler: ((message: string) => void) | null = null;

export function setAuthToken(token: string | null): void {
  const normalized = typeof token === 'string' && token.trim() ? token.trim() : null;
  if (memoryAuthToken !== normalized) {
    authGeneration += 1;
  }
  memoryAuthToken = normalized;
}

export function bumpAuthGeneration(): void {
  authGeneration += 1;
}

export function setOnUnauthorizedHandler(handler: ((message: string) => void) | null): void {
  onUnauthorizedHandler = handler;
}

export const DEFAULT_PRODUCTION_BACKEND_URL =
  'https://buddyaiagent3103-production.up.railway.app';

export interface BackendHealthResponse {
  ok: boolean;
  status: 'ok' | 'degraded';
  uptimeSeconds?: number;
  nodeVersion?: string;
  ai?: { configured: boolean; model: string; fallbackModel?: string | null };
  messaging?: { configured: boolean; number: string | null; error?: string | null };
  database?: { engine: string; durable: boolean; mode: string; warning?: string | null; ok?: boolean };
  adminSetup?: { hasEnvPasscode: boolean; hasClaimedPasscode: boolean; hasAdminUser: boolean };
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function isProjectVercelHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return /^buddy-ai-agent-(?:3103|31)(?:-[a-z0-9-]+)*\.vercel\.app$/.test(lower);
}

export function isAiStudioPreviewHostname(hostname: string): boolean {
  const lower = hostname.trim().toLowerCase();
  return /^ais-(?:dev|pre)-[a-z0-9.-]+\.run\.app$/.test(lower);
}

function normalizeBareBackendUrl(cleaned: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned) || cleaned.startsWith('/')) {
    return cleaned;
  }
  if (/^(?:localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)(?:\/.*)?$/i.test(cleaned)) {
    return `http://${cleaned}`;
  }
  if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(cleaned)) {
    return `https://${cleaned}`;
  }
  return cleaned;
}

export function buildApiUrl(baseUrl: string, path: string): string {
  const cleanBase = baseUrl.trim().replace(/\/+$/, '').replace(/(?:\/api)+$/i, '');
  const withLeadingSlash = (path.startsWith('/') ? path : `/${path}`).replace(/\/{2,}/g, '/');
  const dedupedPath = withLeadingSlash.replace(/^(\/api)+(?=\/|$)/i, '/api');
  return cleanBase ? `${cleanBase}${dedupedPath}` : dedupedPath;
}

export function resolveApiBase(
  raw: unknown,
  currentLocation: { protocol: string; hostname: string; origin: string } | undefined =
    typeof window !== 'undefined' ? window.location : undefined,
  isDev: boolean = Boolean(import.meta.env?.DEV)
): { baseUrl: string; configError?: string } {
  if (currentLocation && isAiStudioPreviewHostname(currentLocation.hostname)) {
    return { baseUrl: '' };
  }

  const rawStr = typeof raw === 'string' ? raw.trim().replace(/^["']+|["']+$/g, '').trim() : '';

  if (!rawStr || rawStr === 'undefined' || rawStr === 'null' || rawStr === '/' || /^\/api\/?$/i.test(rawStr)) {
    if (currentLocation && isProjectVercelHostname(currentLocation.hostname)) {
      return { baseUrl: DEFAULT_PRODUCTION_BACKEND_URL };
    }
    return { baseUrl: '' };
  }

  const stripped = rawStr.replace(/\/+$/, '').replace(/(?:\/api)+$/i, '');
  const cleaned = normalizeBareBackendUrl(stripped);
  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return {
      baseUrl: '',
      configError: 'VITE_API_BASE_URL is malformed. Expected a full https:// or http:// backend URL.',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      baseUrl: '',
      configError: 'VITE_API_BASE_URL must use https:// or http://.',
    };
  }

  // In local development on localhost/127.0.0.1, route to local Express (port 3000 / Vite proxy)
  // rather than accidentally sending dev traffic to a remote production URL copied into .env.
  if (currentLocation && isLocalHostname(currentLocation.hostname) && isDev && !isLocalHostname(parsed.hostname)) {
    return { baseUrl: '' };
  }

  // Never allow private Railway internal domains in browser code
  if (parsed.hostname.toLowerCase().endsWith('.railway.internal')) {
    return {
      baseUrl: '',
      configError:
        'VITE_API_BASE_URL cannot use a private .railway.internal domain in the browser. Configure your public Railway URL (for example https://buddyaiagent3103-production.up.railway.app).',
    };
  }

  // Never allow a deployed production site on a public hostname to call localhost/127.0.0.1
  if (currentLocation && !isLocalHostname(currentLocation.hostname) && isLocalHostname(parsed.hostname)) {
    return {
      baseUrl: '',
      configError:
        'VITE_API_BASE_URL cannot point to localhost on a deployed website. Configure it to your live Railway backend URL.',
    };
  }

  if (
    currentLocation &&
    currentLocation.protocol === 'https:' &&
    parsed.protocol === 'http:' &&
    !isLocalHostname(parsed.hostname)
  ) {
    return {
      baseUrl: '',
      configError: 'VITE_API_BASE_URL must use https:// when the website is served over HTTPS.',
    };
  }

  // On Vercel project deployments, never loop API calls back onto the Vercel frontend itself
  if (
    currentLocation &&
    isProjectVercelHostname(currentLocation.hostname) &&
    parsed.hostname.toLowerCase().endsWith('.vercel.app')
  ) {
    return { baseUrl: DEFAULT_PRODUCTION_BACKEND_URL };
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '').replace(/(?:\/api)+$/i, '');
  return { baseUrl: `${parsed.origin}${cleanPath}` };
}

export function getApiBaseConfig(): { baseUrl: string; configError?: string } {
  return resolveApiBase(import.meta.env?.VITE_API_BASE_URL);
}

let startupValidationRan = false;
export function validateApiConfigAtStartup(): { baseUrl: string; configError?: string } {
  const cfg = getApiBaseConfig();
  if (!startupValidationRan && typeof window !== 'undefined') {
    startupValidationRan = true;
    if (cfg.configError) {
      console.error(`[Buddy API Config] ${cfg.configError}`);
    }
  }
  return cfg;
}

validateApiConfigAtStartup();

function looksLikeHtml(text: string, contentType: string): boolean {
  const lowerType = contentType.toLowerCase();
  if (lowerType.includes('text/html') || lowerType.includes('application/xhtml+xml')) {
    return true;
  }
  const head = text.trimStart().slice(0, 120);
  return /^(?:<!--[\s\S]*?-->\s*)?<(?:!doctype\s+html|html|head|body)\b/i.test(head);
}

function defaultCodeForStatus(status: number): string | undefined {
  if (status === 401) return 'AUTH_ERROR';
  if (status === 403) return 'FORBIDDEN_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMIT';
  if (status === 503) return 'SERVICE_UNAVAILABLE';
  if (status === 504) return 'TIMEOUT_ERROR';
  if (status >= 500) return 'SERVER_ERROR';
  return undefined;
}

function parseRetryAfterHeader(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const num = Number(trimmed);
  if (Number.isFinite(num) && num > 0) return Math.ceil(num);
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
    return diffSec > 0 ? diffSec : undefined;
  }
  return undefined;
}

function extractApiError(
  data: Record<string, unknown>,
  fallbackStatus: number,
  retryAfterHeader?: number
): {
  message: string;
  code?: string;
  retryAfterSeconds?: number;
  rateLimitSource?: string;
  quotaExhausted?: boolean;
  userMessageSaved?: boolean;
  userMessage?: SavedErrorUserMessage;
  model?: string;
  fallbackAttempted?: boolean;
  attemptedModels?: string[];
} {
  const nestedError = data.error;
  const obj = nestedError && typeof nestedError === 'object' ? (nestedError as Record<string, unknown>) : undefined;

  const rawRetry =
    typeof obj?.retryAfterSeconds === 'number'
      ? obj.retryAfterSeconds
      : typeof data.retryAfterSeconds === 'number'
      ? data.retryAfterSeconds
      : retryAfterHeader;
  const retryAfterSeconds =
    typeof rawRetry === 'number' && Number.isFinite(rawRetry) && rawRetry > 0 ? Math.ceil(rawRetry) : undefined;

  const rateLimitSource =
    typeof obj?.rateLimitSource === 'string'
      ? obj.rateLimitSource
      : typeof data.rateLimitSource === 'string'
      ? data.rateLimitSource
      : undefined;

  const quotaExhausted =
    typeof obj?.quotaExhausted === 'boolean'
      ? obj.quotaExhausted
      : typeof data.quotaExhausted === 'boolean'
      ? data.quotaExhausted
      : undefined;

  const userMessageSaved = typeof data.userMessageSaved === 'boolean' ? data.userMessageSaved : undefined;
  const rawUserMessage =
    data.userMessage && typeof data.userMessage === 'object' ? (data.userMessage as SavedErrorUserMessage) : undefined;
  const userMessage =
    rawUserMessage && typeof rawUserMessage.id === 'string' && typeof rawUserMessage.content === 'string'
      ? rawUserMessage
      : undefined;
  const model = typeof data.model === 'string' ? data.model : undefined;
  const fallbackAttempted = typeof data.fallbackAttempted === 'boolean' ? data.fallbackAttempted : undefined;
  const rawAttempted = Array.isArray(obj?.attemptedModels)
    ? obj.attemptedModels
    : Array.isArray(data.attemptedModels)
    ? data.attemptedModels
    : undefined;
  const attemptedModels = rawAttempted?.filter((m): m is string => typeof m === 'string');

  const extraMeta = {
    retryAfterSeconds,
    rateLimitSource,
    quotaExhausted,
    userMessageSaved,
    userMessage,
    model,
    fallbackAttempted,
    attemptedModels,
  };

  if (obj) {
    const msg = typeof obj.message === 'string' && obj.message.trim() ? obj.message : undefined;
    const code =
      typeof obj.code === 'string'
        ? obj.code
        : typeof data.code === 'string'
        ? data.code
        : defaultCodeForStatus(fallbackStatus);
    if (msg) return { message: msg, code, ...extraMeta };
  }
  if (typeof nestedError === 'string' && nestedError.trim()) {
    return {
      message: nestedError,
      code: typeof data.code === 'string' ? data.code : defaultCodeForStatus(fallbackStatus),
      ...extraMeta,
    };
  }
  if (typeof data.message === 'string' && data.message.trim()) {
    return {
      message: data.message,
      code: typeof data.code === 'string' ? data.code : defaultCodeForStatus(fallbackStatus),
      ...extraMeta,
    };
  }
  return {
    message:
      fallbackStatus === 404
        ? 'The requested API route was not found on the backend server.'
        : `Request failed with status ${fallbackStatus}. Please try again.`,
    code: typeof data.code === 'string' ? data.code : defaultCodeForStatus(fallbackStatus),
    ...extraMeta,
  };
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: unknown;
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const { baseUrl, configError } = getApiBaseConfig();
  if (configError) {
    throw new ApiError(configError, 0, 'INVALID_API_URL');
  }

  const method = options.method ?? 'GET';
  const reqAuthGeneration = authGeneration;
  const headers: Record<string, string> = {
    'X-Requested-With': 'BuddyElderAI',
  };
  if (memoryAuthToken) {
    headers['Authorization'] = `Bearer ${memoryAuthToken}`;
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const targetUrl = buildApiUrl(baseUrl, path);
  const normalizedPath = targetUrl.startsWith('http') ? new URL(targetUrl).pathname : targetUrl;
  const timeoutMs = options.timeoutMs ?? 35_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(targetUrl, {
      method,
      credentials: 'include',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiError(
        'The Buddy Elder AI server took too long to respond. Please tap Retry in a moment.',
        504,
        'TIMEOUT_ERROR'
      );
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError(
        'You appear to be offline. Please check your internet connection and try again.',
        0,
        'NETWORK_OFFLINE'
      );
    }
    const browserOrigin = typeof window !== 'undefined' ? window.location.origin : '';
    let isCrossOrigin = false;
    if (baseUrl) {
      try {
        isCrossOrigin = !browserOrigin || new URL(baseUrl).origin !== browserOrigin;
      } catch {
        isCrossOrigin = true;
      }
    }
    if (isCrossOrigin) {
      throw new ApiError(
        `Could not connect to the configured backend server (${baseUrl}). Verify that the backend is running, VITE_API_BASE_URL is correct, and ALLOWED_ORIGINS includes ${browserOrigin || 'this site origin'}.`,
        0,
        'CORS_OR_BACKEND_ERROR'
      );
    }
    throw new ApiError(
      'The Buddy Elder AI backend server is unavailable. Locally, run npm run dev (port 3000); in production, verify your /api backend deployment or VITE_API_BASE_URL.',
      0,
      'BACKEND_UNAVAILABLE'
    );
  } finally {
    clearTimeout(timer);
  }

  const contentType = res.headers.get('content-type') || '';
  const rawText = await res.text();
  const trimmed = rawText.trim();

  let data: Record<string, unknown> = {};
  let parsedJson = false;

  if (
    trimmed.length > 0 &&
    (contentType.toLowerCase().includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('['))
  ) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      } else {
        data = { value: parsed };
      }
      parsedJson = true;
    } catch {
      parsedJson = false;
    }
  }

  if (!parsedJson) {
    if (looksLikeHtml(rawText, contentType)) {
      throw new ApiError(
        `The backend API returned an HTML page instead of JSON (HTTP ${res.status || 502} on ${normalizedPath}). Locally, run npm run dev (port 3000); if frontend and backend are hosted separately, set VITE_API_BASE_URL to your live Express server URL.`,
        res.status || 502,
        'INVALID_RESPONSE'
      );
    }
    if (!res.ok) {
      throw new ApiError(
        trimmed || `Request failed with status ${res.status}.`,
        res.status,
        defaultCodeForStatus(res.status)
      );
    }
    if (res.status !== 204 && trimmed.length > 0) {
      throw new ApiError(
        'The server returned an unexpected response format. Please try again in a moment.',
        res.status || 502,
        'INVALID_RESPONSE'
      );
    }
  }

  if (!res.ok || data.success === false) {
    const headerRetry = parseRetryAfterHeader(res.headers.get('retry-after'));
    const errInfo = extractApiError(data, res.status || 500, headerRetry);
    if (
      res.status === 401 &&
      onUnauthorizedHandler &&
      !normalizedPath.startsWith('/api/auth/') &&
      reqAuthGeneration === authGeneration
    ) {
      onUnauthorizedHandler(errInfo.message);
    }
    throw new ApiError(errInfo.message, res.status || 500, errInfo.code, {
      retryAfterSeconds: errInfo.retryAfterSeconds,
      rateLimitSource: errInfo.rateLimitSource,
      quotaExhausted: errInfo.quotaExhausted,
      userMessageSaved: errInfo.userMessageSaved,
      userMessage: errInfo.userMessage,
      model: errInfo.model,
      fallbackAttempted: errInfo.fallbackAttempted,
      attemptedModels: errInfo.attemptedModels,
    });
  }

  return data as T;
}

export async function checkBackendHealth(timeoutMs = 10_000): Promise<BackendHealthResponse> {
  const health = await apiRequest<BackendHealthResponse>('/api/health', { timeoutMs });
  if (!health || health.ok !== true || health.status !== 'ok') {
    throw new ApiError(
      'Backend server reported a degraded health state.',
      503,
      'BACKEND_DEGRADED'
    );
  }
  if (health.database && health.database.ok === false) {
    throw new ApiError(
      health.database.warning || 'Backend database health check failed.',
      503,
      'DATABASE_UNAVAILABLE'
    );
  }
  return health;
}
