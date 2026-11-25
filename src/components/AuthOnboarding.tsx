import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, KeyRound, Shield, UserCheck, Volume2 } from 'lucide-react';
import type { PublicUser, SupportedLanguage, UserRole, UserSettings, VoiceSpeed } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { LANGUAGE_LABELS, t } from '../lib/i18n.ts';
import { isSpeechSynthesisSupported, speakText, stopSpeaking } from '../lib/speech.ts';
import { BrandMark } from './BrandMark.tsx';

type AuthMode = 'splash' | 'login' | 'register' | 'forgot' | 'admin';

const AUTH_PATH_TO_MODE: Record<string, AuthMode> = {
  '/': 'splash',
  '/login': 'login',
  '/register': 'register',
  '/forgot-password': 'forgot',
  '/admin': 'admin',
};

const AUTH_MODE_TO_PATH: Record<AuthMode, string> = {
  splash: '/',
  login: '/login',
  register: '/register',
  forgot: '/forgot-password',
  admin: '/admin',
};

function readInitialAuthMode(): AuthMode {
  if (typeof window === 'undefined') return 'splash';
  return AUTH_PATH_TO_MODE[window.location.pathname] ?? 'splash';
}

export function AuthOnboarding() {
  const { guestLanguage, setGuestLanguage, adminSetup, backendHealth, setAuthData, refreshSession, sessionNotice, clearSessionNotice } = useApp();
  const [mode, setModeState] = useState<AuthMode>(() => (sessionNotice ? 'login' : readInitialAuthMode()));
  const effectiveNotice =
    sessionNotice || (backendHealth.status === 'unavailable' || backendHealth.status === 'degraded' ? backendHealth.error : null);

  function setMode(next: AuthMode) {
    setModeState(next);
    if (typeof window !== 'undefined') {
      const targetPath = AUTH_MODE_TO_PATH[next];
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ authMode: next }, '', targetPath);
      }
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => {
      setModeState(readInitialAuthMode());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [role, setRole] = useState<'senior' | 'caregiver'>('senior');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [devResetHint, setDevResetHint] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  const [adminPasscode, setAdminPasscode] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminName, setAdminName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  const languages: SupportedLanguage[] = ['en', 'hi', 'mr', 'hinglish'];

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ user: PublicUser; settings: UserSettings; token: string }>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setAuthData(res.user, res.settings, res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ user: PublicUser; settings: UserSettings; token: string }>('/api/auth/register', {
        method: 'POST',
        body: {
          name,
          email,
          phone,
          password,
          role,
          language: guestLanguage,
        },
      });
      setAuthData(res.user, res.settings, res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create account.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string; devResetCode?: string }>(
        '/api/auth/forgot-password',
        {
          method: 'POST',
          body: { email },
        }
      );
      setResetSent(true);
      setInfo(res.message);
      setDevResetHint(res.devResetCode ?? null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to start password reset.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ ok: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: { email, code: resetCode, newPassword: password },
      });
      setInfo(res.message);
      setResetSent(false);
      setMode('login');
      setPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to reset password.');
    } finally {
      setSubmitting(false);
    }
  }

  const isAdminClaimNeeded = !adminSetup.hasEnvPasscode && !adminSetup.hasClaimedPasscode;

  async function handleAdminSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const endpoint = isAdminClaimNeeded ? '/api/auth/admin/claim' : '/api/auth/admin/login';
      const res = await apiRequest<{ user: PublicUser; settings: UserSettings; token: string }>(endpoint, {
        method: 'POST',
        body: isAdminClaimNeeded
          ? { email: adminEmail || 'admin@buddyelder.local', name: adminName || 'Platform Administrator', passcode: adminPasscode }
          : { email: adminEmail || undefined, passcode: adminPasscode },
      });
      setAuthData(res.user, res.settings, res.token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Admin authentication failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#FAF8F5] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
          <button
            type="button"
            onClick={() => {
              setMode('splash');
              setError(null);
            }}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BrandMark className="w-8 h-8 shrink-0" />
            <span className="font-display text-lg font-bold tracking-tight">{t(guestLanguage, 'brand')}</span>
          </button>

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl" role="group" aria-label="Select Language">
              {languages.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setGuestLanguage(lang)}
                  className={`px-3 py-1.5 min-h-[40px] rounded-lg text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    guestLanguage === lang
                      ? 'bg-[#0F5156] text-white'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {LANGUAGE_LABELS[lang].native}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12">
        {mode === 'splash' ? (
          <div className="space-y-6">
            {effectiveNotice && (
              <div role="status" className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200 text-base flex flex-wrap items-center justify-between gap-3">
                <span>{effectiveNotice}</span>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => void refreshSession()}
                    className="text-xs font-semibold underline cursor-pointer"
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={clearSessionNotice}
                    className="text-xs font-semibold underline cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
              <div className="space-y-4">
                <p className="text-sm font-semibold text-[#0F5156] dark:text-teal-400">
                  {t(guestLanguage, 'tagline')}
                </p>
                <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-white leading-tight">
                  {t(guestLanguage, 'brand')}
                </h1>
                <p className="text-lg text-slate-700 dark:text-slate-300 max-w-xl">
                  {guestLanguage === 'hi'
                    ? 'बुज़ुर्गों के लिए सरल और सुरक्षित डिजिटल साथी — बोलकर सवाल पूछें, धोखाधड़ी जाँचें, और परिवार से जुड़े रहें।'
                    : guestLanguage === 'mr'
                    ? 'ज्येष्ठ नागरिकांसाठी सोपा आणि सुरक्षित डिजिटल सोबती — बोलून प्रश्न विचारा, फसवणूक तपासा आणि कुटुंबाशी जोडलेले राहा.'
                    : guestLanguage === 'hinglish'
                    ? 'Seniors ke liye simple aur safe digital companion — bolkar sawaal poochein, scam check karein, aur family se jude rahein.'
                    : 'A warm, accessible companion helping older adults navigate smartphones, verify suspicious messages, learn step by step, and stay connected with trusted family.'}
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('register');
                  }}
                  className="min-h-[54px] px-7 py-3.5 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold text-lg flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <span>{t(guestLanguage, 'getStarted')}</span>
                  <ArrowRight className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('login');
                  }}
                  className="min-h-[54px] px-7 py-3.5 rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold text-lg cursor-pointer"
                >
                  Sign In
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">Voice & Large Text</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Speak questions or listen aloud</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">Scam Protection</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">Check links, SMS & calls safely</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-900 dark:text-white">Senior-Owned Privacy</p>
                  <p className="text-sm text-slate-600 dark:text-slate-400">You control family sharing</p>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setMode('admin');
                  }}
                  className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white underline underline-offset-4 cursor-pointer min-h-[44px] inline-flex items-center gap-1.5"
                >
                  <KeyRound className="w-4 h-4" />
                  <span>{isAdminClaimNeeded ? 'First-Run Admin Setup' : 'Administrator Sign In'}</span>
                </button>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[300px] rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#EFECE6] dark:bg-slate-900 hc-surface">
                {!imgFailed ? (
                  <img
                    src="/src/assets/images/senior_welcome_hero_1795245243674.jpg"
                    alt="An older adult smiling comfortably while reading a tablet beside a cup of tea"
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="w-full h-full object-cover min-h-[320px]"
                  />
                ) : (
                  <div className="w-full h-full min-h-[320px] flex flex-col items-center justify-center p-8 text-center">
                    <BrandMark className="w-16 h-16 mb-4" />
                    <p className="font-display text-2xl font-bold">{t(guestLanguage, 'brand')}</p>
                    <p className="text-slate-600 dark:text-slate-400 mt-1">{t(guestLanguage, 'tagline')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
        ) : (
          <div className="max-w-lg mx-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface">
            <div className="flex items-center justify-between gap-4 mb-6">
              <h1 className="font-display text-2xl font-bold">
                {mode === 'register'
                  ? 'Create Your Account'
                  : mode === 'login'
                  ? 'Welcome Back'
                  : mode === 'forgot'
                  ? 'Reset Your Password'
                  : isAdminClaimNeeded
                  ? 'First-Run Administrator Setup'
                  : 'Administrator Sign In'}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setMode('splash');
                  setError(null);
                  setInfo(null);
                }}
                className="text-sm font-medium text-[#0F5156] dark:text-teal-400 hover:underline min-h-[44px] px-2 cursor-pointer"
              >
                Back
              </button>
            </div>

            {effectiveNotice && !error && (
              <div role="status" className="mb-4 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200 text-base flex items-center justify-between gap-3">
                <span>{effectiveNotice}</span>
                <button
                  type="button"
                  onClick={clearSessionNotice}
                  className="text-xs font-semibold underline shrink-0 cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            )}
            {error && (
              <div role="alert" className="mb-4 p-4 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 text-red-900 dark:text-red-200 text-base">
                {error}
              </div>
            )}
            {info && (
              <div role="status" className="mb-4 p-4 rounded-2xl bg-teal-50 dark:bg-teal-950/50 border border-teal-300 dark:border-teal-800 text-teal-900 dark:text-teal-200 text-base">
                {info}
                {devResetHint && (
                  <p className="mt-2 font-mono-nums font-bold">
                    Verification Code: {devResetHint}
                  </p>
                )}
              </div>
            )}

            {mode === 'register' && (
              <form onSubmit={handleRegister} className="space-y-4">
                <div>
                  <span className="block text-sm font-semibold mb-2">I am signing up as:</span>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setRole('senior')}
                      className={`min-h-[54px] p-3 rounded-2xl border-2 font-semibold text-left flex items-center gap-2 cursor-pointer ${
                        role === 'senior'
                          ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <UserCheck className="w-5 h-5 shrink-0" />
                      <span>Senior User</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setRole('caregiver')}
                      className={`min-h-[54px] p-3 rounded-2xl border-2 font-semibold text-left flex items-center gap-2 cursor-pointer ${
                        role === 'caregiver'
                          ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Shield className="w-5 h-5 shrink-0" />
                      <span>Family / Caregiver</span>
                    </button>
                  </div>
                </div>

                <div>
                  <label htmlFor="reg-name" className="block text-sm font-semibold mb-1">
                    Full Name
                  </label>
                  <input
                    id="reg-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Asha Deshmukh"
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>

                <div>
                  <label htmlFor="reg-email" className="block text-sm font-semibold mb-1">
                    Email Address
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>

                <div>
                  <label htmlFor="reg-phone" className="block text-sm font-semibold mb-1">
                    Phone Number (Optional)
                  </label>
                  <input
                    id="reg-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Include country code starting with +"
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>

                <div>
                  <label htmlFor="reg-pass" className="block text-sm font-semibold mb-1">
                    Password (minimum 6 characters)
                  </label>
                  <input
                    id="reg-pass"
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[52px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-60 text-white font-semibold text-lg cursor-pointer"
                >
                  {submitting ? 'Creating Account...' : 'Create Account'}
                </button>

                <p className="text-center text-sm text-slate-600 dark:text-slate-400">
                  Already have an account?{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError(null);
                    }}
                    className="font-semibold text-[#0F5156] dark:text-teal-400 underline cursor-pointer"
                  >
                    Sign In
                  </button>
                </p>
              </form>
            )}

            {mode === 'login' && (
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-sm font-semibold mb-1">
                    Email Address
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>
                <div>
                  <label htmlFor="login-pass" className="block text-sm font-semibold mb-1">
                    Password
                  </label>
                  <input
                    id="login-pass"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[52px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-60 text-white font-semibold text-lg cursor-pointer"
                >
                  {submitting ? 'Signing In...' : 'Sign In'}
                </button>

                <div className="flex items-center justify-between text-sm pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                      setInfo(null);
                    }}
                    className="text-slate-600 dark:text-slate-400 hover:underline cursor-pointer min-h-[44px]"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMode('register');
                      setError(null);
                    }}
                    className="font-semibold text-[#0F5156] dark:text-teal-400 hover:underline cursor-pointer min-h-[44px]"
                  >
                    Create Account
                  </button>
                </div>
              </form>
            )}

            {mode === 'forgot' && (
              <form onSubmit={resetSent ? handleResetSubmit : handleForgot} className="space-y-4">
                <div>
                  <label htmlFor="forgot-email" className="block text-sm font-semibold mb-1">
                    Registered Email Address
                  </label>
                  <input
                    id="forgot-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>
                {resetSent && (
                  <>
                    <div>
                      <label htmlFor="reset-code" className="block text-sm font-semibold mb-1">
                        6-Digit Verification Code
                      </label>
                      <input
                        id="reset-code"
                        type="text"
                        required
                        value={resetCode}
                        onChange={(e) => setResetCode(e.target.value)}
                        className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-nums text-base"
                      />
                    </div>
                    <div>
                      <label htmlFor="reset-newpass" className="block text-sm font-semibold mb-1">
                        New Password (min 6 chars)
                      </label>
                      <input
                        id="reset-newpass"
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                      />
                    </div>
                  </>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[52px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-60 text-white font-semibold text-lg cursor-pointer"
                >
                  {submitting ? 'Please wait...' : resetSent ? 'Update Password' : 'Request Reset Code'}
                </button>
              </form>
            )}

            {mode === 'admin' && (
              <form onSubmit={handleAdminSubmit} className="space-y-4">
                {!adminSetup.hasEnvPasscode && (
                  <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200">
                    {isAdminClaimNeeded
                      ? 'ADMIN_PASSCODE is not set in server environment variables (.env, .env.local, or deployment environment). You can set ADMIN_PASSCODE on the server or claim first-run admin access below.'
                      : 'ADMIN_PASSCODE is not set in server environment variables; authenticating against the claimed server passcode.'}
                  </div>
                )}
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {isAdminClaimNeeded
                    ? 'Choose a strong passcode (at least 8 characters) to claim the first administrator account.'
                    : 'Enter your administrator passcode to open the platform console.'}
                </p>
                {isAdminClaimNeeded && (
                  <>
                    <div>
                      <label htmlFor="adm-name" className="block text-sm font-semibold mb-1">
                        Admin Name
                      </label>
                      <input
                        id="adm-name"
                        type="text"
                        value={adminName}
                        onChange={(e) => setAdminName(e.target.value)}
                        placeholder="Platform Administrator"
                        className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                      />
                    </div>
                    <div>
                      <label htmlFor="adm-email" className="block text-sm font-semibold mb-1">
                        Admin Email
                      </label>
                      <input
                        id="adm-email"
                        type="email"
                        value={adminEmail}
                        onChange={(e) => setAdminEmail(e.target.value)}
                        placeholder="admin@buddyelder.local"
                        className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                      />
                    </div>
                  </>
                )}
                <div>
                  <label htmlFor="adm-pass" className="block text-sm font-semibold mb-1">
                    {isAdminClaimNeeded ? 'Create Admin Passcode (min 8 chars)' : 'Admin Passcode'}
                  </label>
                  <input
                    id="adm-pass"
                    type="password"
                    required
                    minLength={isAdminClaimNeeded ? 8 : 1}
                    value={adminPasscode}
                    onChange={(e) => setAdminPasscode(e.target.value)}
                    className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full min-h-[52px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-60 text-white font-semibold text-lg cursor-pointer"
                >
                  {submitting
                    ? 'Verifying...'
                    : isAdminClaimNeeded
                    ? 'Claim Administrator Access'
                    : 'Sign In as Administrator'}
                </button>
              </form>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export function SeniorVoiceSetupModal({ onComplete }: { onComplete: () => void }) {
  const { user, settings, updateSettings, logout } = useApp();
  const [voiceEnabled, setVoiceEnabled] = useState(settings?.voice_enabled ?? true);
  const [voiceSpeed, setVoiceSpeed] = useState<VoiceSpeed>(settings?.voice_speed ?? 'normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lang = user?.language ?? 'en';
  const ttsSupported = isSpeechSynthesisSupported();

  function previewVoice() {
    const sample =
      lang === 'hi'
        ? 'नमस्ते! मैं आपका बडी एल्डर एआई साथी हूँ।'
        : lang === 'mr'
        ? 'नमस्कार! मी तुमचा बडी एल्डर एआय मित्र आहे.'
        : lang === 'hinglish'
        ? 'Namaste! Main aapka Buddy Elder AI saathi hoon.'
        : 'Hello! I am Buddy Elder AI. I will read answers clearly at this speed.';
    speakText(sample, { language: lang, speed: voiceSpeed });
  }

  async function saveAndContinue() {
    stopSpeaking();
    setSaving(true);
    setError(null);
    try {
      await updateSettings({
        voice_enabled: voiceEnabled,
        voice_speed: voiceSpeed,
        onboarding_completed: true,
      });
      onComplete();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save voice preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto my-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface space-y-6">
      <div className="space-y-2">
        <h2 className="font-display text-2xl font-bold">Welcome, {user?.name}! Set Up Your Voice</h2>
        <p className="text-slate-600 dark:text-slate-400">
          Choose whether you would like Buddy Elder AI to read answers aloud and how fast it should speak. You can change this anytime in Settings.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/50 border border-red-300 dark:border-red-800 text-red-900 dark:text-red-200 space-y-2">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-sm font-semibold underline cursor-pointer"
          >
            Return to Sign In
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-slate-200 dark:border-slate-800">
          <div>
            <p className="font-semibold">Spoken Voice Output</p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {ttsSupported ? 'Read answers and lessons aloud' : 'Browser speech output is unavailable on this device'}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={voiceEnabled}
            onClick={() => setVoiceEnabled((v) => !v)}
            className={`min-h-[48px] px-5 rounded-xl font-semibold cursor-pointer ${
              voiceEnabled ? 'bg-[#0F5156] text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200'
            }`}
          >
            {voiceEnabled ? 'Enabled' : 'Disabled'}
          </button>
        </div>

        <div>
          <span className="block font-semibold mb-2">Speaking Speed</span>
          <div className="grid grid-cols-3 gap-3">
            {(['slow', 'normal', 'fast'] as VoiceSpeed[]).map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => setVoiceSpeed(spd)}
                className={`min-h-[48px] rounded-xl border-2 font-semibold capitalize cursor-pointer ${
                  voiceSpeed === spd
                    ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {spd}
              </button>
            ))}
          </div>
        </div>

        {ttsSupported && voiceEnabled && (
          <button
            type="button"
            onClick={previewVoice}
            className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center justify-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Volume2 className="w-5 h-5" />
            <span>Preview Voice</span>
          </button>
        )}
      </div>

      <button
        type="button"
        disabled={saving}
        onClick={saveAndContinue}
        className="w-full min-h-[54px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold text-lg flex items-center justify-center gap-2 cursor-pointer"
      >
        <Check className="w-5 h-5" />
        <span>{saving ? 'Saving...' : 'Save & Go to Dashboard'}</span>
      </button>
    </div>
  );
}
