import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBuddyChatConfig,
  classifyGeminiError,
  getClient,
  getConfiguredFallbackGeminiModel,
  getConfiguredGeminiModel,
  redactSecrets,
  type AiServiceErrorCode,
} from './ai.ts';
import { getEnvLoadReport, getGeminiKeyInfo } from './env.ts';

export type DiagnosticCategory = 'ok' | 'skipped' | AiServiceErrorCode;

export interface DiagnosticStep {
  id: 'config' | 'auth' | 'model' | 'generate' | 'chat_request';
  label: string;
  ok: boolean;
  category: DiagnosticCategory;
  httpStatus?: number;
  reason?: string;
  message: string;
}

export interface GeminiDiagnosticReport {
  ok: boolean;
  verdict: string;
  model: string;
  fallbackModel: string | null;
  fallbackOk?: boolean;
  fallbackCategory?: DiagnosticCategory;
  fallbackMessage?: string;
  availableModels: string[];
  modelProbes?: Array<{ model: string; ok: boolean; durationMs: number; category: DiagnosticCategory; message: string }>;
  sdkVersion: string | null;
  key: {
    configured: boolean;
    varName?: string | null;
    source: string;
    length: number;
    looksLikeStandardKey: boolean;
    formatIssue: string | null;
    /** One-way hash prefix; only included when requested (CLI). Never the key. */
    fingerprint?: string | null;
  };
  env: { directory: string; filesRead: string[]; overridden: string[]; conflicts: string[] };
  steps: DiagnosticStep[];
}

function readSdkVersion(): string | null {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/@google/genai/package.json'), 'utf8')
    ) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function withTimeout<T>(fn: () => Promise<T>, ms = 20000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('ETIMEDOUT: diagnostic step timed out')), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Checks Gemini connectivity independently of the chat route, in isolated steps so the failure
 * category is unambiguous (invalid key vs. restricted vs. model vs. quota/billing vs. network).
 * Never returns or logs the API key.
 */
export async function runGeminiDiagnostics(
  options: { includeFingerprint?: boolean; probeModels?: boolean } = {}
): Promise<GeminiDiagnosticReport> {
  const model = getConfiguredGeminiModel();
  const fallbackModel = getConfiguredFallbackGeminiModel(model);
  const keyInfo = getGeminiKeyInfo();
  const envReport = getEnvLoadReport();
  const steps: DiagnosticStep[] = [];
  let availableModels: string[] = [];
  let fallbackOk: boolean | undefined;
  let fallbackCategory: DiagnosticCategory | undefined;
  let fallbackMessage: string | undefined;
  let modelProbes: Array<{ model: string; ok: boolean; durationMs: number; category: DiagnosticCategory; message: string }> | undefined;

  const report = (): GeminiDiagnosticReport => {
    const failed = steps.find((s) => !s.ok && s.category !== 'skipped');
    const overallOk = (!failed && steps.length > 0) || Boolean(fallbackOk && failed?.id !== 'auth' && failed?.id !== 'config');
    let verdict = 'Gemini key, model and chat request all work.';
    if (failed) {
      verdict = fallbackOk && fallbackModel
        ? `Primary model ${model} failed (${failed.message}), but fallback model ${fallbackModel} works.`
        : `${failed.label}: ${failed.message}`;
    }
    return {
      ok: overallOk,
      verdict,
      model,
      fallbackModel,
      ...(fallbackCategory ? { fallbackOk, fallbackCategory, fallbackMessage } : {}),
      availableModels,
      ...(modelProbes ? { modelProbes } : {}),
      sdkVersion: readSdkVersion(),
      key: {
        configured: keyInfo.configured,
        varName: keyInfo.varName,
        source: keyInfo.source,
        length: keyInfo.length,
        looksLikeStandardKey: keyInfo.looksLikeStandardKey,
        formatIssue: keyInfo.formatIssue,
        ...(options.includeFingerprint ? { fingerprint: keyInfo.fingerprint } : {}),
      },
      env: {
        directory: envReport.directory,
        filesRead: envReport.filesRead,
        overridden: envReport.overridden,
        conflicts: envReport.conflicts,
      },
      steps,
    };
  };

  const skip = (id: DiagnosticStep['id'], label: string, why: string) =>
    steps.push({ id, label, ok: false, category: 'skipped', message: `Skipped: ${why}` });

  // Step 1: configuration
  if (!keyInfo.configured) {
    steps.push({
      id: 'config',
      label: 'Configuration',
      ok: false,
      category: 'MISSING_API_KEY',
      message: 'GEMINI_API_KEY is missing or still a placeholder in the server environment.',
    });
    skip('auth', 'Authentication', 'no key configured');
    skip('model', 'Model availability', 'no key configured');
    skip('generate', 'Minimal generation', 'no key configured');
    skip('chat_request', 'Chat request shape', 'no key configured');
    return report();
  }
  steps.push({
    id: 'config',
    label: 'Configuration',
    ok: !keyInfo.formatIssue,
    category: keyInfo.formatIssue ? 'AI_CONFIG_ERROR' : 'ok',
    message: keyInfo.formatIssue ?? `Key loaded from ${keyInfo.varName ?? 'GEMINI_API_KEY'} (${keyInfo.source}, ${keyInfo.length} characters).`,
  });
  if (keyInfo.formatIssue) {
    skip('auth', 'Authentication', 'key format problem');
    skip('model', 'Model availability', 'key format problem');
    skip('generate', 'Minimal generation', 'key format problem');
    skip('chat_request', 'Chat request shape', 'key format problem');
    return report();
  }

  const ai = getClient();

  const runStep = async (
    id: DiagnosticStep['id'],
    label: string,
    okMessage: string,
    fn: () => Promise<string | void>
  ): Promise<boolean> => {
    try {
      const extra = await withTimeout(fn);
      steps.push({ id, label, ok: true, category: 'ok', message: (extra as string) || okMessage });
      return true;
    } catch (err) {
      const c = classifyGeminiError(err, model);
      steps.push({
        id,
        label,
        ok: false,
        category: c.code,
        httpStatus: c.upstreamStatus,
        reason: c.geminiErrorCode,
        message: redactSecrets(c.message),
      });
      return false;
    }
  };

  // Step 2: authentication only (lists models; independent of the configured model)
  const authOk = await runStep('auth', 'Authentication', 'Google accepted the key and the API is reachable.', async () => {
    const pager = await ai.models.list({ config: { pageSize: 100 } });
    const page = Array.isArray(pager.page) ? pager.page : [];
    availableModels = page
      .map((m) => (m as { name?: string }).name?.replace(/^models\//, '') ?? '')
      .filter((name) => Boolean(name))
      .slice(0, 100);
  });
  if (!authOk) {
    skip('model', 'Model availability', 'authentication failed');
    skip('generate', 'Minimal generation', 'authentication failed');
    skip('chat_request', 'Chat request shape', 'authentication failed');
    return report();
  }

  // Step 3: model exists and supports generateContent
  await runStep('model', 'Model availability', `Model "${model}" exists for this key.`, async () => {
    const info = await ai.models.get({ model });
    const actions = (info as { supportedActions?: string[] }).supportedActions;
    if (Array.isArray(actions) && actions.length > 0 && !actions.includes('generateContent')) {
      throw new Error(`models/${model} is not supported for generateContent`);
    }
  });

  // Step 4: minimal generation (quota, billing, per-model permission)
  const genOk = await runStep('generate', 'Minimal generation', 'A tiny test prompt was answered.', async () => {
    await ai.models.generateContent({
      model,
      contents: 'Reply with the single word: ok',
      config: { maxOutputTokens: 32 },
    });
  });
  if (!genOk) {
    skip('chat_request', 'Chat request shape', 'minimal generation failed');
  } else {
    // Step 5: the exact request shape AI Buddy chat uses (thinking level + JSON schema)
    await runStep('chat_request', 'Chat request shape', 'The chat request settings are accepted by this model.', async () => {
      await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: 'Say hello in one short sentence.' }] }],
        config: buildBuddyChatConfig('You are a friendly assistant.', undefined, model),
      });
    });
  }

  // Fallback model verification (when primary hit quota/error or to confirm backup readiness)
  if (fallbackModel) {
    try {
      await withTimeout(
        () =>
          ai.models.generateContent({
            model: fallbackModel,
            contents: [{ role: 'user', parts: [{ text: 'Say hello in one short sentence.' }] }],
            config: buildBuddyChatConfig('You are a friendly assistant.', undefined, fallbackModel),
          }),
        25000
      );
      fallbackOk = true;
      fallbackCategory = 'ok';
      fallbackMessage = `Fallback model "${fallbackModel}" responded normally.`;
    } catch (err) {
      const c = classifyGeminiError(err, fallbackModel);
      fallbackOk = false;
      fallbackCategory = c.code;
      fallbackMessage = redactSecrets(c.message);
    }
  }

  if (options.probeModels) {
    const probeList = Array.from(
      new Set([
        model,
        ...(fallbackModel ? [fallbackModel] : []),
        'gemini-4-hydrogen',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.5-flash-lite',
        'gemini-3.1-flash-lite-preview',
        'gemini-3-flash-preview',
        'gemini-flash-latest',
      ])
    );
    modelProbes = [];
    for (const candidate of probeList) {
      const t0 = Date.now();
      try {
        await withTimeout(
          () =>
            ai.models.generateContent({
              model: candidate,
              contents: [{ role: 'user', parts: [{ text: 'Say hello in one short sentence.' }] }],
              config: buildBuddyChatConfig('You are a friendly assistant.', undefined, candidate),
            }),
          20000
        );
        modelProbes.push({ model: candidate, ok: true, durationMs: Date.now() - t0, category: 'ok', message: 'ok' });
      } catch (err) {
        const c = classifyGeminiError(err, candidate);
        modelProbes.push({
          model: candidate,
          ok: false,
          durationMs: Date.now() - t0,
          category: c.code,
          message: redactSecrets(c.message),
        });
      }
    }
  }

  return report();
}
