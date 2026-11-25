import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  HelpCircle,
  MessageSquare,
  RefreshCw,
  Smartphone,
  Unplug,
  Users,
} from 'lucide-react';
import type { MessagingOnboardingStatus, MessagingSetupMode } from '../../shared/types.ts';
import { ApiError, apiRequest } from '../lib/api.ts';

interface OnboardingRecord {
  id: string;
  setup_mode: MessagingSetupMode;
  senior_phone: string | null;
  status: MessagingOnboardingStatus;
  verified_at: string | null;
  updated_at: string;
}

const STATUS_LABELS: Record<MessagingOnboardingStatus, string> = {
  not_started: 'Not Started',
  instructions_viewed: 'Instructions Viewed',
  ready_to_send: 'Ready to Send HELLO',
  user_confirmed: 'Message Sent — User Confirmed',
  backend_verified: 'Conversation Activated — Backend Verified',
};

export function MessagingOnboardingView() {
  const [configured, setConfigured] = useState(false);
  const [messagingNumber, setMessagingNumber] = useState<string | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingRecord | null>(null);
  const [setupMode, setSetupMode] = useState<MessagingSetupMode>('self');
  const [seniorPhone, setSeniorPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copiedTarget, setCopiedTarget] = useState<'number' | 'hello' | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiRequest<{
        configured: boolean;
        messagingNumber: string | null;
        configError?: string | null;
        onboarding: OnboardingRecord;
      }>('/api/messaging/onboarding');
      setConfigured(res.configured);
      setMessagingNumber(res.messagingNumber);
      setConfigError(res.configError ?? null);
      setOnboarding(res.onboarding);
      setSetupMode(res.onboarding.setup_mode);
      setSeniorPhone(res.onboarding.senior_phone ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load messaging onboarding.');
    } finally {
      setLoading(false);
    }
  }

  async function updateOnboarding(patch: {
    setupMode?: MessagingSetupMode;
    seniorPhone?: string;
    status?: MessagingOnboardingStatus;
  }) {
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ onboarding: OnboardingRecord }>('/api/messaging/onboarding', {
        method: 'PUT',
        body: patch,
      });
      setOnboarding(res.onboarding);
      setSetupMode(res.onboarding.setup_mode);
      setSeniorPhone(res.onboarding.senior_phone ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update onboarding state.');
    } finally {
      setSaving(false);
    }
  }

  async function disconnectMessaging() {
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest<{ onboarding: OnboardingRecord }>('/api/messaging/onboarding/disconnect', {
        method: 'POST',
      });
      setOnboarding(res.onboarding);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset messaging onboarding.');
    } finally {
      setSaving(false);
    }
  }

  function copyValue(value: string, target: 'number' | 'hello') {
    void navigator.clipboard?.writeText(value);
    setCopiedTarget(target);
    setTimeout(() => setCopiedTarget(null), 2000);
  }

  if (loading) {
    return <p className="p-6 text-lg">Loading messaging setup...</p>;
  }

  const currentStatus = onboarding?.status ?? 'not_started';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Phone Messaging Onboarding</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Connect your own phone number to Buddy Elder AI by sending the first HELLO message.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadStatus()}
          className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold inline-flex items-center gap-2 self-start cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Check Verification Status</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 border border-red-300 text-red-900">
          {error}
        </div>
      )}

      {/* Critical Initiation Rule Banner */}
      <div className="p-5 rounded-3xl bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-500 space-y-2">
        <p className="font-display text-lg font-bold">
          Important Rule: The first message MUST come from the senior’s own phone number.
        </p>
        <p className="text-slate-800 dark:text-slate-200">
          A family member or caregiver may help the senior open Messages on the senior’s phone, but the caregiver must NOT send HELLO from the caregiver’s personal phone.
        </p>
      </div>

      {/* Mode Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => {
            setSetupMode('self');
            void updateOnboarding({
              setupMode: 'self',
              status: currentStatus === 'not_started' ? 'instructions_viewed' : undefined,
            });
          }}
          className={`p-5 rounded-3xl border-2 text-left space-y-1.5 cursor-pointer ${
            setupMode === 'self'
              ? 'border-[#0F5156] bg-teal-50/70 dark:bg-teal-950/40'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center gap-2 font-display text-lg font-bold">
            <Smartphone className="w-5 h-5 text-[#0F5156] dark:text-teal-400" />
            <span>Option A — I Am Setting It Up Myself</span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Simple step-by-step instructions to send HELLO from your own phone.
          </p>
        </button>

        <button
          type="button"
          onClick={() => {
            setSetupMode('caregiver_assisted');
            void updateOnboarding({
              setupMode: 'caregiver_assisted',
              status: currentStatus === 'not_started' ? 'instructions_viewed' : undefined,
            });
          }}
          className={`p-5 rounded-3xl border-2 text-left space-y-1.5 cursor-pointer ${
            setupMode === 'caregiver_assisted'
              ? 'border-[#0F5156] bg-teal-50/70 dark:bg-teal-950/40'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
          }`}
        >
          <div className="flex items-center gap-2 font-display text-lg font-bold">
            <Users className="w-5 h-5 text-[#0F5156] dark:text-teal-400" />
            <span>Option B — My Family Member or Caregiver Is Helping</span>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Guidance for helping the senior send HELLO from the senior’s own phone.
          </p>
        </button>
      </div>

      {/* Main Onboarding Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface space-y-5">
          <h2 className="font-display text-2xl font-bold">Start Using Buddy Elder AI</h2>

          {!configured ? (
            <div className="p-5 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-[#C2592B] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold">
                  {configError || "Buddy Elder AI's messaging number is not configured yet. Please contact the administrator."}
                </p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Administrators can configure BUDDY_MESSAGING_NUMBER (with country code starting with +) in server environment variables, the Admin Console, or via the messaging CLI.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-5 rounded-2xl bg-[#F3F0EA] dark:bg-slate-800 border border-slate-300 dark:border-slate-700 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-600 dark:text-slate-400">Buddy Elder AI Messaging Number</p>
                  <p className="font-mono-nums text-2xl font-bold">{messagingNumber}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copyValue(messagingNumber!, 'number')}
                    className="min-h-[44px] px-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    <span>{copiedTarget === 'number' ? 'Number Copied' : 'Copy Number'}</span>
                  </button>
                  <a
                    href={`sms:${messagingNumber}?body=HELLO`}
                    onClick={() => void updateOnboarding({ status: 'ready_to_send' })}
                    className="min-h-[44px] px-4 rounded-xl bg-[#0F5156] text-white font-semibold inline-flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-4 h-4" />
                    <span>Open Messages App</span>
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Instructions Card */}
          <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-3">
            <p className="font-semibold">Let&apos;s connect you with Buddy Elder AI!</p>
            {setupMode === 'self' ? (
              <ol className="list-decimal pl-5 space-y-2 text-base">
                <li>Open the Messages app on YOUR phone.</li>
                <li>Start a new message to the configured Buddy Elder AI number.</li>
                <li>
                  Type{' '}
                  <span className="inline-block px-3 py-0.5 mx-1 rounded-lg bg-[#0F5156] text-white font-mono-nums font-bold tracking-wider">
                    HELLO
                  </span>
                </li>
                <li>Press Send.</li>
              </ol>
            ) : (
              <ol className="list-decimal pl-5 space-y-2 text-base">
                <li>Ask the senior to hold or use THEIR own phone.</li>
                <li>Help them open the Messages app on the senior’s phone.</li>
                <li>Enter the configured Buddy Elder AI number.</li>
                <li>
                  Type{' '}
                  <span className="inline-block px-3 py-0.5 mx-1 rounded-lg bg-[#0F5156] text-white font-mono-nums font-bold tracking-wider">
                    HELLO
                  </span>
                </li>
                <li>Help them press Send from the senior’s phone number (never from the caregiver’s personal phone).</li>
              </ol>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <button
                type="button"
                onClick={() => copyValue('HELLO', 'hello')}
                className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>{copiedTarget === 'hello' ? 'HELLO Copied' : 'Copy HELLO'}</span>
              </button>
              <button
                type="button"
                onClick={() => setShowHelp((h) => !h)}
                className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <HelpCircle className="w-4 h-4" />
                <span>Setup Help</span>
              </button>
            </div>
          </div>

          {/* Senior Phone Number Input & Honest Confirmation */}
          <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
            <label htmlFor="senior-msg-phone" className="block font-semibold">
              Senior’s Own Phone Number (Used to Send HELLO)
            </label>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                id="senior-msg-phone"
                type="tel"
                value={seniorPhone}
                onChange={(e) => setSeniorPhone(e.target.value)}
                placeholder="Include country code starting with +"
                className="flex-1 min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-nums"
              />
              <button
                type="button"
                disabled={saving}
                onClick={() =>
                  void updateOnboarding({
                    seniorPhone,
                    status: currentStatus === 'not_started' ? 'ready_to_send' : undefined,
                  })
                }
                className="min-h-[48px] px-5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
              >
                Save Senior Number
              </button>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                disabled={saving || !configured}
                onClick={() => void updateOnboarding({ seniorPhone, status: 'user_confirmed' })}
                className="min-h-[50px] px-6 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-50 text-white font-semibold flex items-center gap-2 cursor-pointer"
              >
                <CheckCircle2 className="w-5 h-5" />
                <span>I Sent HELLO From My Phone</span>
              </button>

              {currentStatus !== 'not_started' && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void disconnectMessaging()}
                  className="min-h-[50px] px-5 rounded-2xl border border-red-300 text-red-700 dark:text-red-400 font-semibold flex items-center gap-2 cursor-pointer"
                >
                  <Unplug className="w-4 h-4" />
                  <span>Disconnect / Reset</span>
                </button>
              )}
            </div>
          </div>

          {showHelp && (
            <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 space-y-1.5 text-sm">
              <p className="font-semibold">Troubleshooting Setup:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Make sure you are using the senior’s own phone and SIM number.</li>
                <li>Check mobile network signal or SMS balance.</li>
                <li>Verify the Buddy Elder AI messaging number digit by digit.</li>
                <li>Ensure you pressed the Send button after typing HELLO.</li>
                <li>If no response arrives, ask a caregiver to check the number or run the developer messaging CLI (`npm run cli:messaging -- status`).</li>
              </ul>
            </div>
          )}
        </section>

        {/* Honest 5-Step Status Tracker */}
        <aside className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4">
          <h2 className="font-display text-xl font-bold">Connection Status</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Current Status: <strong className="text-slate-900 dark:text-white">{STATUS_LABELS[currentStatus]}</strong>
          </p>

          <div className="space-y-2.5">
            {(
              [
                'not_started',
                'instructions_viewed',
                'ready_to_send',
                'user_confirmed',
                'backend_verified',
              ] as MessagingOnboardingStatus[]
            ).map((step, idx) => {
              const order = ['not_started', 'instructions_viewed', 'ready_to_send', 'user_confirmed', 'backend_verified'];
              const activeIdx = order.indexOf(currentStatus);
              const reached = idx <= activeIdx;
              return (
                <div
                  key={step}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3 ${
                    reached
                      ? 'border-[#0F5156] bg-teal-50/60 dark:bg-teal-950/30 font-semibold'
                      : 'border-slate-200 dark:border-slate-800 text-slate-500'
                  }`}
                >
                  <span className="font-mono-nums text-sm w-6 h-6 rounded-full border border-current flex items-center justify-center shrink-0">
                    {idx + 1}
                  </span>
                  <span>{STATUS_LABELS[step]}</span>
                </div>
              );
            })}
          </div>

          {currentStatus === 'user_confirmed' && (
            <p className="text-sm text-amber-800 dark:text-amber-300">
              Marked as user-confirmed. Full activation updates to &ldquo;Conversation Activated — Backend Verified&rdquo; once the messaging backend verifies your incoming HELLO message.
            </p>
          )}
          {currentStatus === 'backend_verified' && onboarding?.verified_at && (
            <p className="text-sm text-emerald-700 dark:text-emerald-300 font-semibold">
              Verified on {new Date(onboarding.verified_at).toLocaleString()}.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
