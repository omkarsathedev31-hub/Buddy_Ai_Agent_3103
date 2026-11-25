import React, { useEffect, useRef, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  PauseCircle,
  Phone,
  PhoneOff,
  RefreshCw,
  ShieldAlert,
  Volume2,
} from 'lucide-react';
import type { RiskLevel } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { speakText } from '../lib/speech.ts';

interface ScamResult {
  id: string;
  riskLevel: RiskLevel;
  explanation: string;
  indicators: string[];
  recommendedActions: string[];
  requiresPause: boolean;
  source: 'ai' | 'heuristic_fallback' | 'heuristic_offline';
}

interface RawScamAssessmentPayload {
  id?: unknown;
  riskLevel?: unknown;
  risk_level?: unknown;
  explanation?: unknown;
  indicators?: unknown;
  recommendedActions?: unknown;
  actions?: unknown;
  requiresPause?: unknown;
  source?: unknown;
  assessment?: RawScamAssessmentPayload;
}

function normalizeScamResult(raw: RawScamAssessmentPayload): ScamResult {
  const src = raw?.assessment && typeof raw.assessment === 'object' ? raw.assessment : raw;
  const rawLevel = src.riskLevel ?? src.risk_level ?? raw.riskLevel ?? raw.risk_level;
  const riskLevel: RiskLevel =
    rawLevel === 'RED' || rawLevel === 'YELLOW' || rawLevel === 'GREEN' ? rawLevel : 'YELLOW';

  const explanationRaw = src.explanation ?? raw.explanation;
  const explanation =
    typeof explanationRaw === 'string' && explanationRaw.trim()
      ? explanationRaw.trim()
      : 'Please review these safety details carefully before taking any action.';

  const rawIndicators = src.indicators ?? raw.indicators;
  const indicators = Array.isArray(rawIndicators)
    ? rawIndicators.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

  const rawActions = src.recommendedActions ?? src.actions ?? raw.recommendedActions ?? raw.actions;
  const recommendedActions = Array.isArray(rawActions)
    ? rawActions.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];

  const rawSource = src.source ?? raw.source;
  const source: ScamResult['source'] =
    rawSource === 'heuristic_offline'
      ? 'heuristic_offline'
      : rawSource === 'heuristic_fallback'
      ? 'heuristic_fallback'
      : 'ai';

  const idRaw = src.id ?? raw.id;
  return {
    id: typeof idRaw === 'string' && idRaw ? idRaw : `scam-${Date.now()}`,
    riskLevel,
    explanation,
    indicators: indicators.length > 0 ? indicators : ['Safety check completed'],
    recommendedActions:
      recommendedActions.length > 0
        ? recommendedActions
        : ['Verify independently with an official number or trusted family member.'],
    requiresPause: Boolean(src.requiresPause ?? raw.requiresPause ?? riskLevel !== 'GREEN'),
    source,
  };
}

interface EmergencyContact {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  is_primary: number;
}

export function ScamSafetyView({ onNavigateHome }: { onNavigateHome: () => void }) {
  const { user, settings } = useApp();
  const [tab, setTab] = useState<'check' | 'call_safety'>('check');
  const [inputType, setInputType] = useState<'sms' | 'whatsapp' | 'url' | 'phone' | 'email'>('sms');
  const [content, setContent] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<ScamResult | null>(null);
  const [history, setHistory] = useState<Array<{ id: string; input_type: string; content: string; risk_level: RiskLevel; created_at: string }>>([]);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryCooldownSec, setRetryCooldownSec] = useState(0);
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  // 30-second Pause & Think modal state
  const [pauseOpen, setPauseOpen] = useState(false);
  const [pauseSeconds, setPauseSeconds] = useState(30);
  const analyzingRef = useRef(false);

  useEffect(() => {
    void loadExtras();
  }, []);

  useEffect(() => {
    if (!pauseOpen || pauseSeconds <= 0) return;
    const timer = setTimeout(() => setPauseSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [pauseOpen, pauseSeconds]);

  useEffect(() => {
    if (retryCooldownSec <= 0) return;
    const timer = setTimeout(() => {
      setRetryCooldownSec((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryCooldownSec]);

  async function loadExtras() {
    try {
      const [histRes, contactRes] = await Promise.all([
        apiRequest<{ assessments: Array<{ id: string; input_type: string; content: string; risk_level: RiskLevel; created_at: string }> }>('/api/scam/history'),
        user?.role === 'senior'
          ? apiRequest<{ contacts: EmergencyContact[] }>('/api/senior/contacts')
          : Promise.resolve({ contacts: [] }),
      ]);
      setHistory(histRes.assessments);
      setContacts(contactRes.contacts);
    } catch {
      // non-fatal
    }
  }

  async function runAnalyze() {
    const trimmed = content.trim();
    if (!trimmed || analyzingRef.current || retryCooldownSec > 0) return;
    analyzingRef.current = true;
    setError(null);
    setReportNotice(null);
    setAnalyzing(true);
    try {
      const raw = await apiRequest<RawScamAssessmentPayload>('/api/scam/analyze', {
        method: 'POST',
        body: { content: trimmed, inputType, language: user?.language ?? 'en' },
        timeoutMs: 25_000,
      });
      const res = normalizeScamResult(raw);
      setResult(res);
      setRetryCooldownSec(0);
      if (res.requiresPause || res.riskLevel === 'RED') {
        setPauseSeconds(30);
        setPauseOpen(true);
      }
      void loadExtras();
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const rawWait = err.retryAfterSeconds ?? 15;
        setRetryCooldownSec(Math.min(Math.max(1, rawWait), 60));
      } else {
        setRetryCooldownSec(0);
      }
      setError(err instanceof ApiError ? err.message : 'Unable to check message right now.');
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  }

  function handleAnalyze(e: React.FormEvent) {
    e.preventDefault();
    void runAnalyze();
  }

  function handleClearText() {
    if (analyzingRef.current || analyzing) return;
    setContent('');
    setError(null);
    setRetryCooldownSec(0);
    setResult(null);
    setReportNotice(null);
  }

  async function handleReportSuspicious() {
    if (!content.trim()) return;
    try {
      await apiRequest('/api/scam/report', {
        method: 'POST',
        body: { content, notes: result?.explanation || 'Reported from Scam Safety checker' },
      });
      setReportNotice('Reported safely. Authorized family members have been alerted to check in with you.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send report.');
    }
  }

  const primaryContact = contacts[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Is This Safe? & Call Safety</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Check suspicious texts, WhatsApp messages, links, phone numbers, or urgent calls before acting.
          </p>
        </div>
        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl self-start">
          <button
            type="button"
            onClick={() => setTab('check')}
            className={`min-h-[44px] px-4 rounded-xl font-semibold cursor-pointer ${
              tab === 'check' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Message & Link Check
          </button>
          <button
            type="button"
            onClick={() => setTab('call_safety')}
            className={`min-h-[44px] px-4 rounded-xl font-semibold cursor-pointer ${
              tab === 'call_safety' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Call Safety Guide
          </button>
        </div>
      </div>

      {tab === 'check' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-5">
            <form
              onSubmit={handleAnalyze}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4"
            >
              <div>
                <span className="block text-sm font-semibold mb-2">What are you checking?</span>
                <div className="flex flex-wrap gap-2">
                  {(['sms', 'whatsapp', 'url', 'phone', 'email'] as const).map((tp) => (
                    <button
                      key={tp}
                      type="button"
                      disabled={analyzing}
                      onClick={() => {
                        setInputType(tp);
                        if (error) setError(null);
                      }}
                      className={`min-h-[44px] px-4 rounded-xl border font-semibold uppercase text-sm cursor-pointer disabled:opacity-50 ${
                        inputType === tp
                          ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                          : 'border-slate-300 dark:border-slate-700'
                      }`}
                    >
                      {tp}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label htmlFor="scam-input" className="block text-sm font-semibold mb-2">
                  Paste the message, link, or phone number
                </label>
                <textarea
                  id="scam-input"
                  rows={5}
                  required
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="Example: Dear customer, your bank KYC will expire today. Share OTP or click bit.ly/verify..."
                  className="w-full p-4 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className={`p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    retryCooldownSec > 0
                      ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 text-amber-950 dark:text-amber-100'
                      : 'bg-red-50 dark:bg-red-950/50 border-red-300 text-red-900 dark:text-red-200'
                  }`}
                >
                  <p className="text-sm font-medium">{error}</p>
                  <button
                    type="button"
                    disabled={analyzing || retryCooldownSec > 0 || !content.trim()}
                    onClick={() => void runAnalyze()}
                    className={`min-h-[44px] px-4 rounded-xl disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-1.5 shrink-0 cursor-pointer ${
                      retryCooldownSec > 0 ? 'bg-amber-700 hover:bg-amber-800' : 'bg-red-700 hover:bg-red-800'
                    }`}
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>{retryCooldownSec > 0 ? `Retry in ${retryCooldownSec}s` : 'Retry'}</span>
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="submit"
                  disabled={analyzing || retryCooldownSec > 0 || !content.trim()}
                  className="flex-1 min-h-[54px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-50 text-white font-semibold text-lg cursor-pointer"
                >
                  {analyzing ? 'Checking Carefully...' : 'Check Safety Now'}
                </button>
                <button
                  type="button"
                  disabled={analyzing || (!content && !result && !error)}
                  onClick={handleClearText}
                  className="min-h-[54px] px-5 rounded-2xl border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 font-semibold cursor-pointer"
                >
                  Clear Text
                </button>
              </div>
            </form>

            {result && (
              <div
                className={`rounded-3xl p-6 border-2 space-y-4 ${
                  result.riskLevel === 'RED'
                    ? 'bg-red-50 dark:bg-red-950/40 border-red-600 text-red-950 dark:text-red-100'
                    : result.riskLevel === 'YELLOW'
                    ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-600 text-amber-950 dark:text-amber-100'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-600 text-emerald-950 dark:text-emerald-100'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {result.riskLevel === 'RED' ? (
                      <AlertOctagon className="w-8 h-8 text-red-700 dark:text-red-400 shrink-0" />
                    ) : result.riskLevel === 'YELLOW' ? (
                      <AlertTriangle className="w-8 h-8 text-amber-700 dark:text-amber-400 shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-8 h-8 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    )}
                    <div>
                      <h2 className="font-display text-xl font-bold">
                        {result.riskLevel === 'RED'
                          ? 'RED — Likely Scam'
                          : result.riskLevel === 'YELLOW'
                          ? 'YELLOW — Be Careful'
                          : 'GREEN — No Obvious Risk Found'}
                      </h2>
                      <p className="text-sm opacity-85">
                        {result.source === 'heuristic_offline'
                          ? 'Rule-based offline check (AI deep analysis unavailable without GEMINI_API_KEY)'
                          : result.source === 'heuristic_fallback'
                          ? 'Safety rules check completed (deep AI analysis was temporarily busy) · Always verify carefully'
                          : 'AI + safety rules analysis · Automated checks cannot guarantee 100% safety'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      speakText(`${result.riskLevel}. ${result.explanation}`, {
                        language: user?.language ?? 'en',
                        speed: settings?.voice_speed ?? 'normal',
                      })
                    }
                    className="min-h-[44px] px-3 rounded-xl bg-white/90 dark:bg-slate-900 text-slate-900 dark:text-white font-semibold flex items-center gap-1.5 cursor-pointer shrink-0"
                  >
                    <Volume2 className="w-4 h-4" />
                    <span>Listen</span>
                  </button>
                </div>

                <p className="text-base leading-relaxed">{result.explanation}</p>

                <div>
                  <h3 className="font-semibold mb-1.5">What We Noticed:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {result.indicators.map((ind, idx) => (
                      <li key={`${idx}-${ind}`}>{ind}</li>
                    ))}
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold mb-1.5">Safe Next Steps:</h3>
                  <ul className="list-disc pl-5 space-y-1">
                    {result.recommendedActions.map((act, idx) => (
                      <li key={`${idx}-${act}`}>{act}</li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  {primaryContact ? (
                    <a
                      href={`tel:${primaryContact.phone}`}
                      className="min-h-[48px] px-5 rounded-2xl bg-slate-900 text-white font-semibold inline-flex items-center gap-2"
                    >
                      <Phone className="w-5 h-5" />
                      <span>Call {primaryContact.name}</span>
                    </a>
                  ) : (
                    <span className="text-sm font-medium self-center">
                      Add a trusted family phone number in Family &amp; Permissions for one-tap calling.
                    </span>
                  )}

                  {user?.role === 'senior' && (
                    <button
                      type="button"
                      onClick={() => void handleReportSuspicious()}
                      className="min-h-[48px] px-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-400 text-slate-900 dark:text-white font-semibold cursor-pointer"
                    >
                      Alert My Family
                    </button>
                  )}
                </div>

                {reportNotice && <p className="font-semibold text-sm">{reportNotice}</p>}
              </div>
            )}
          </div>

          <aside className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4">
            <h2 className="font-display text-xl font-bold">Recent Checks</h2>
            {history.length === 0 ? (
              <p className="text-slate-600 dark:text-slate-400">
                No messages checked yet. Paste any suspicious SMS, WhatsApp text, or link on the left.
              </p>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span>
                        {item.risk_level} · {item.input_type.toUpperCase()}
                      </span>
                      <span className="font-mono-nums text-slate-500">
                        {new Date(item.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-sm line-clamp-2 text-slate-700 dark:text-slate-300">{item.content}</p>
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface space-y-6">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-8 h-8 text-[#C2592B] shrink-0" />
            <div>
              <h2 className="font-display text-2xl font-bold">Call Safety — What To Do On A Suspicious Call</h2>
              <p className="text-slate-600 dark:text-slate-400">
                Real banks, police, and government officials NEVER ask for OTPs, PINs, passwords, or remote screen-sharing apps over the phone.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              {
                title: 'Fake Bank / KYC / Card Block Calls',
                body: 'Hang up immediately. Call only the official customer care number printed on the back of your debit/credit card.',
              },
              {
                title: 'OTP or UPI PIN Requests',
                body: 'You never need to share an OTP or enter a UPI PIN to receive money or claim a refund.',
              },
              {
                title: 'Remote Access Apps (AnyDesk / TeamViewer)',
                body: 'Never install screen-sharing apps requested by an unknown caller. They allow strangers to see and control your phone.',
              },
              {
                title: 'Threats ("Police / Digital Arrest / Customs")',
                body: 'Scammers use fear and urgency to stop you from calling family. Hang up and call your trusted family member right away.',
              },
            ].map((card) => (
              <div key={card.title} className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                <h3 className="font-display text-lg font-bold">{card.title}</h3>
                <p className="text-slate-700 dark:text-slate-300">{card.body}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            {primaryContact && (
              <a
                href={`tel:${primaryContact.phone}`}
                className="min-h-[52px] px-6 rounded-2xl bg-[#0F5156] text-white font-semibold inline-flex items-center gap-2"
              >
                <Phone className="w-5 h-5" />
                <span>Call {primaryContact.name} ({primaryContact.phone})</span>
              </a>
            )}
            <button
              type="button"
              onClick={() => setTab('check')}
              className="min-h-[52px] px-6 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer inline-flex items-center gap-2"
            >
              <PhoneOff className="w-5 h-5" />
              <span>Check a Message or Number</span>
            </button>
          </div>
        </div>
      )}

      {/* Pause & Think 30-Second Safety Modal */}
      {pauseOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pause-title"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border-2 border-[#C2592B] space-y-5">
            <div className="flex items-center gap-3">
              <PauseCircle className="w-9 h-9 text-[#C2592B] shrink-0" />
              <div>
                <h2 id="pause-title" className="font-display text-2xl font-bold">
                  Pause &amp; Think Before Acting
                </h2>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Urgency is a common scam trick. Take a calm breath.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-2">
              <p className="font-semibold">
                {pauseSeconds > 0
                  ? `Recommended calm pause: ${pauseSeconds}s remaining`
                  : 'Pause complete — take your time verifying safely'}
              </p>
              <ul className="text-sm list-disc pl-5 space-y-1">
                <li>Do NOT click links, share OTPs, or send money under pressure.</li>
                <li>Call your family or official institution directly to double-check.</li>
                <li>If this is a medical or physical emergency, dial 112 / 108 / 911 immediately without waiting.</li>
              </ul>
            </div>

            <div className="flex flex-wrap gap-3">
              {primaryContact && (
                <a
                  href={`tel:${primaryContact.phone}`}
                  className="min-h-[48px] px-5 rounded-2xl bg-[#0F5156] text-white font-semibold inline-flex items-center gap-2"
                >
                  <Phone className="w-5 h-5" />
                  <span>Call {primaryContact.name}</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setPauseOpen(false)}
                className="min-h-[48px] px-5 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
              >
                View Full Safety Report
              </button>
              <button
                type="button"
                onClick={() => {
                  setPauseOpen(false);
                  onNavigateHome();
                }}
                className="min-h-[48px] px-5 rounded-2xl text-slate-600 dark:text-slate-400 font-semibold cursor-pointer"
              >
                Return to Home
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
