import React, { useEffect, useState } from 'react';
import { Download, LogOut, MessageSquareHeart, Trash2, Volume2 } from 'lucide-react';
import type {
  ContrastMode,
  SupportedLanguage,
  TextScale,
  ThemeMode,
  VoiceSpeed,
} from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { LANGUAGE_LABELS, t } from '../lib/i18n.ts';
import { getAvailableVoices, isSpeechSynthesisSupported, speakText } from '../lib/speech.ts';

export function SettingsView() {
  const { user, settings, updateSettings, logout } = useApp();
  const [name, setName] = useState(user?.name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [savingMsg, setSavingMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [fbCategory, setFbCategory] = useState('ease_of_use');
  const [fbRating, setFbRating] = useState(5);
  const [fbMessage, setFbMessage] = useState('');
  const [fbSent, setFbSent] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setVoices(getAvailableVoices());
    if (isSpeechSynthesisSupported()) {
      window.speechSynthesis.onvoiceschanged = () => setVoices(getAvailableVoices());
    }
  }, []);

  if (!user || !settings) return null;

  async function patch(data: Parameters<typeof updateSettings>[0], label: string) {
    setErrorMsg(null);
    try {
      await updateSettings(data);
      setSavingMsg(`${label} saved.`);
      setTimeout(() => setSavingMsg(null), 2500);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : `Unable to save ${label.toLowerCase()}.`);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    await patch({ name, phone }, 'Profile');
  }

  async function submitFeedback(e: React.FormEvent) {
    e.preventDefault();
    setFbSent(null);
    try {
      await apiRequest('/api/feedback', {
        method: 'POST',
        body: { category: fbCategory, rating: fbRating, message: fbMessage },
      });
      setFbMessage('');
      setFbSent('Thank you! Your feedback has been saved.');
    } catch (err) {
      setFbSent(err instanceof ApiError ? err.message : 'Unable to send feedback.');
    }
  }

  async function exportMyData() {
    setErrorMsg(null);
    try {
      const bundle = await apiRequest<Record<string, unknown>>('/api/account/export');
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `buddy-elder-ai-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Unable to export account data.');
    }
  }

  async function deleteAccount() {
    setErrorMsg(null);
    try {
      await apiRequest('/api/account', { method: 'DELETE' });
      await logout({ skipServer: true });
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Unable to delete account right now.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Settings &amp; Accessibility</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Personalize text size, contrast, theme, language, voice speed, and account privacy.
          </p>
        </div>
        {savingMsg && (
          <p role="status" className="px-4 py-2 rounded-xl bg-teal-50 dark:bg-teal-950/50 border border-teal-400 font-semibold text-sm">
            {savingMsg}
          </p>
        )}
      </div>

      {errorMsg && (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-300 text-red-900 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 space-y-6">
          {/* Language & Display */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-5">
            <h2 className="font-display text-xl font-bold">Language &amp; Display</h2>

            <div>
              <span className="block text-sm font-semibold mb-2">Language</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['en', 'hi', 'mr', 'hinglish'] as SupportedLanguage[]).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => void patch({ language: l }, 'Language')}
                    className={`min-h-[48px] rounded-xl border-2 font-semibold cursor-pointer ${
                      user.language === l
                        ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {LANGUAGE_LABELS[l].native}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="block text-sm font-semibold mb-2">Text Size</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  { val: 'sm', label: 'Small' },
                  { val: 'normal', label: 'Normal' },
                  { val: 'lg', label: 'Large' },
                  { val: 'xl', label: 'Extra Large' },
                ] as Array<{ val: TextScale; label: string }>).map((s) => (
                  <button
                    key={s.val}
                    type="button"
                    onClick={() => void patch({ text_size: s.val }, 'Text size')}
                    className={`min-h-[48px] rounded-xl border-2 font-semibold cursor-pointer ${
                      settings.text_size === s.val
                        ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="block text-sm font-semibold mb-2">Theme</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['light', 'dark'] as ThemeMode[]).map((tm) => (
                    <button
                      key={tm}
                      type="button"
                      onClick={() => void patch({ theme: tm }, 'Theme')}
                      className={`min-h-[48px] rounded-xl border-2 font-semibold capitalize cursor-pointer ${
                        settings.theme === tm
                          ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {tm}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="block text-sm font-semibold mb-2">Contrast</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['standard', 'high'] as ContrastMode[]).map((cm) => (
                    <button
                      key={cm}
                      type="button"
                      onClick={() => void patch({ contrast_mode: cm }, 'Contrast')}
                      className={`min-h-[48px] rounded-xl border-2 font-semibold capitalize cursor-pointer ${
                        settings.contrast_mode === cm
                          ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                          : 'border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {cm}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <label className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 dark:border-slate-800 cursor-pointer min-h-[56px]">
              <span className="font-semibold">Reduced Motion</span>
              <input
                type="checkbox"
                checked={settings.reduced_motion}
                onChange={(e) => void patch({ reduced_motion: e.target.checked }, 'Reduced motion')}
                className="w-5 h-5 accent-[#0F5156]"
              />
            </label>
          </section>

          {/* Voice Settings */}
          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4">
            <h2 className="font-display text-xl font-bold">Voice &amp; Notifications</h2>

            <label className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 dark:border-slate-800 cursor-pointer min-h-[56px]">
              <span className="font-semibold">Automatic Voice Output</span>
              <input
                type="checkbox"
                checked={settings.voice_enabled}
                onChange={(e) => void patch({ voice_enabled: e.target.checked }, 'Voice output')}
                className="w-5 h-5 accent-[#0F5156]"
              />
            </label>

            <div>
              <span className="block text-sm font-semibold mb-2">Voice Speed</span>
              <div className="grid grid-cols-3 gap-2">
                {(['slow', 'normal', 'fast'] as VoiceSpeed[]).map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => void patch({ voice_speed: spd }, 'Voice speed')}
                    className={`min-h-[48px] rounded-xl border-2 font-semibold capitalize cursor-pointer ${
                      settings.voice_speed === spd
                        ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    {spd}
                  </button>
                ))}
              </div>
            </div>

            {voices.length > 0 && (
              <div>
                <label htmlFor="voice-select" className="block text-sm font-semibold mb-1">
                  Preferred Device Voice
                </label>
                <select
                  id="voice-select"
                  value={settings.voice_name ?? ''}
                  onChange={(e) => void patch({ voice_name: e.target.value || null }, 'Preferred voice')}
                  className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                >
                  <option value="">Automatic (match language)</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() =>
                speakText('Hello! This is a preview of your current Buddy Elder AI voice settings.', {
                  language: user.language,
                  speed: settings.voice_speed,
                  voiceName: settings.voice_name,
                })
              }
              className="min-h-[48px] px-5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold inline-flex items-center gap-2 cursor-pointer"
            >
              <Volume2 className="w-5 h-5" />
              <span>Preview Voice</span>
            </button>

            <label className="flex items-center justify-between p-4 rounded-2xl border border-slate-200 dark:border-slate-800 cursor-pointer min-h-[56px]">
              <span className="font-semibold">In-App Notifications</span>
              <input
                type="checkbox"
                checked={settings.notifications_enabled}
                onChange={(e) => void patch({ notifications_enabled: e.target.checked }, 'Notifications')}
                className="w-5 h-5 accent-[#0F5156]"
              />
            </label>
          </section>
        </div>

        {/* Profile, Feedback & Account Actions */}
        <div className="lg:col-span-5 space-y-6">
          <form
            onSubmit={saveProfile}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4"
          >
            <h2 className="font-display text-xl font-bold">Profile Details</h2>
            <div>
              <label htmlFor="set-name" className="block text-sm font-semibold mb-1">
                Full Name
              </label>
              <input
                id="set-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="set-phone" className="block text-sm font-semibold mb-1">
                Phone Number
              </label>
              <input
                id="set-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[48px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold cursor-pointer"
            >
              {t(user.language, 'save')}
            </button>
          </form>

          <form
            onSubmit={submitFeedback}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4"
          >
            <div className="flex items-center gap-2">
              <MessageSquareHeart className="w-5 h-5 text-[#0F5156] dark:text-teal-400" />
              <h2 className="font-display text-xl font-bold">Send Feedback</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select
                aria-label="Feedback Category"
                value={fbCategory}
                onChange={(e) => setFbCategory(e.target.value)}
                className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="ease_of_use">Ease of Use</option>
                <option value="voice">Voice Quality</option>
                <option value="safety">Scam Safety</option>
                <option value="bug">Report a Problem</option>
              </select>
              <select
                aria-label="Rating"
                value={fbRating}
                onChange={(e) => setFbRating(Number(e.target.value))}
                className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value={5}>5 — Very Helpful</option>
                <option value={4}>4 — Good</option>
                <option value={3}>3 — Okay</option>
                <option value={2}>2 — Needs Work</option>
                <option value={1}>1 — Difficult</option>
              </select>
            </div>
            <textarea
              rows={3}
              required
              value={fbMessage}
              onChange={(e) => setFbMessage(e.target.value)}
              placeholder="Tell us what works well or what could be easier..."
              className="w-full p-3.5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
            {fbSent && <p className="text-sm font-semibold text-[#0F5156] dark:text-teal-400">{fbSent}</p>}
            <button
              type="submit"
              className="w-full min-h-[48px] rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              Submit Feedback
            </button>
          </form>

          <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-3">
            <h2 className="font-display text-xl font-bold">Privacy &amp; Account</h2>
            <button
              type="button"
              onClick={() => void exportMyData()}
              className="w-full min-h-[48px] rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Download className="w-5 h-5" />
              <span>Export My Data (JSON)</span>
            </button>

            <button
              type="button"
              onClick={() => void logout()}
              className="w-full min-h-[48px] rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-5 h-5" />
              <span>{t(user.language, 'signOut')}</span>
            </button>

            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="w-full min-h-[48px] rounded-2xl border border-red-300 text-red-700 dark:text-red-400 font-semibold flex items-center justify-center gap-2 cursor-pointer"
              >
                <Trash2 className="w-5 h-5" />
                <span>Delete My Account</span>
              </button>
            ) : (
              <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-400 space-y-2.5">
                <p className="text-sm font-semibold">
                  Are you sure? This permanently deletes your profile, check-ins, and saved chats.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void deleteAccount()}
                    className="min-h-[44px] px-4 rounded-xl bg-red-700 text-white font-semibold cursor-pointer"
                  >
                    Yes, Delete Permanently
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
