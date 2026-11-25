import React, { useEffect, useState } from 'react';
import { CheckCircle2, HeartHandshake } from 'lucide-react';
import type { CheckinMood } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { t } from '../lib/i18n.ts';

interface CheckInRecord {
  id: string;
  checkin_date: string;
  mood: CheckinMood;
  medication_taken: 'yes' | 'no' | 'skipped' | null;
  needs_help: boolean | null;
  wants_family_call: boolean | null;
  feels_safe: boolean | null;
  note: string | null;
  updated_at: string;
}

export function DailyCheckinView({ onCheckinSaved }: { onCheckinSaved?: () => void }) {
  const { user } = useApp();
  const lang = user?.language ?? 'en';

  const [mood, setMood] = useState<CheckinMood>('good');
  const [medicationTaken, setMedicationTaken] = useState<'yes' | 'no' | 'skipped' | null>(null);
  const [needsHelp, setNeedsHelp] = useState<boolean | null>(null);
  const [wantsFamilyCall, setWantsFamilyCall] = useState<boolean | null>(null);
  const [feelsSafe, setFeelsSafe] = useState<boolean | null>(true);
  const [note, setNote] = useState('');

  const [todayExisting, setTodayExisting] = useState<CheckInRecord | null>(null);
  const [history, setHistory] = useState<CheckInRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadCheckIns();
  }, []);

  async function loadCheckIns() {
    setLoading(true);
    try {
      const res = await apiRequest<{ todayCheckIn: CheckInRecord | null; history: CheckInRecord[] }>('/api/checkins');
      setHistory(res.history);
      if (res.todayCheckIn) {
        setTodayExisting(res.todayCheckIn);
        setMood(res.todayCheckIn.mood);
        setMedicationTaken(res.todayCheckIn.medication_taken);
        setNeedsHelp(res.todayCheckIn.needs_help);
        setWantsFamilyCall(res.todayCheckIn.wants_family_call);
        setFeelsSafe(res.todayCheckIn.feels_safe);
        setNote(res.todayCheckIn.note ?? '');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setStatusMsg(null);
    try {
      const res = await apiRequest<{ updated: boolean; checkIn: CheckInRecord }>('/api/checkins', {
        method: 'POST',
        body: {
          mood,
          medicationTaken,
          needsHelp,
          wantsFamilyCall,
          feelsSafe,
          note,
        },
      });
      setStatusMsg(
        res.updated
          ? 'Your check-in for today was updated safely.'
          : 'Thank you! Today’s check-in has been saved.'
      );
      await loadCheckIns();
      onCheckinSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save check-in.');
    } finally {
      setSaving(false);
    }
  }

  function renderTriToggle(
    label: string,
    value: boolean | null,
    onChange: (val: boolean | null) => void
  ) {
    return (
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
        <p className="font-semibold">{label}</p>
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Yes', val: true },
            { label: 'No', val: false },
            { label: 'Skip', val: null },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => onChange(opt.val)}
              className={`min-h-[44px] px-5 rounded-xl border-2 font-semibold cursor-pointer ${
                value === opt.val
                  ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold">{t(lang, 'dailyCheckin')}</h1>
        <p className="text-slate-600 dark:text-slate-400">
          Share a quick update on how you feel. This is for family peace of mind, not medical diagnosis.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={handleSubmit}
          className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface space-y-5"
        >
          {todayExisting && (
            <div className="p-3.5 rounded-2xl bg-teal-50 dark:bg-teal-950/40 border border-teal-300 dark:border-teal-800 flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="w-5 h-5 text-[#0F5156] dark:text-teal-400 shrink-0" />
              <span>You already checked in today ({todayExisting.checkin_date}). Submitting again updates today’s entry without creating duplicates.</span>
            </div>
          )}

          <div>
            <h2 className="font-display text-xl font-bold mb-3">{t(lang, 'howAreYouToday')}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {([
                { val: 'good', label: t(lang, 'good'), tone: 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40' },
                { val: 'okay', label: t(lang, 'okay'), tone: 'border-amber-600 bg-amber-50 dark:bg-amber-950/40' },
                { val: 'not_good', label: t(lang, 'notGood'), tone: 'border-red-600 bg-red-50 dark:bg-red-950/40' },
              ] as const).map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setMood(opt.val)}
                  className={`min-h-[60px] rounded-2xl border-2 font-bold text-lg cursor-pointer ${
                    mood === opt.val ? opt.tone : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
            <p className="font-semibold">Have you taken your regular medication? (Optional)</p>
            <div className="flex flex-wrap gap-2">
              {([
                { label: 'Yes', val: 'yes' },
                { label: 'Not Yet', val: 'no' },
                { label: 'Skip', val: 'skipped' },
              ] as const).map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setMedicationTaken(opt.val)}
                  className={`min-h-[44px] px-5 rounded-xl border-2 font-semibold cursor-pointer ${
                    medicationTaken === opt.val
                      ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156] dark:text-teal-300'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {renderTriToggle('Do you need help with anything today? (Optional)', needsHelp, setNeedsHelp)}
          {renderTriToggle('Would you like to speak with family today? (Optional)', wantsFamilyCall, setWantsFamilyCall)}
          {renderTriToggle('Do you feel safe right now? (Optional)', feelsSafe, setFeelsSafe)}

          <div>
            <label htmlFor="checkin-note" className="block font-semibold mb-1.5">
              Optional Note
            </label>
            <textarea
              id="checkin-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything you would like to note for today..."
              className="w-full p-3.5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          {error && (
            <div role="alert" className="p-3.5 rounded-2xl bg-red-50 border border-red-300 text-red-900">
              {error}
            </div>
          )}
          {statusMsg && (
            <div role="status" className="p-3.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-400 text-emerald-950 dark:text-emerald-100 font-semibold">
              {statusMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full min-h-[54px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold text-lg cursor-pointer"
          >
            {saving ? 'Saving Check-in...' : todayExisting ? 'Update Today’s Check-in' : 'Save Daily Check-in'}
          </button>
        </form>

        <aside className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4">
          <div className="flex items-center gap-2">
            <HeartHandshake className="w-6 h-6 text-[#0F5156] dark:text-teal-400" />
            <h2 className="font-display text-xl font-bold">Check-in History</h2>
          </div>

          {loading ? (
            <p className="text-slate-500">Loading check-in history...</p>
          ) : history.length === 0 ? (
            <p className="text-slate-600 dark:text-slate-400">
              No check-ins recorded yet. Complete your first check-in today.
            </p>
          ) : (
            <div className="space-y-3 max-h-[460px] overflow-y-auto">
              {history.map((c) => (
                <div key={c.id} className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold capitalize">{c.mood.replace('_', ' ')}</span>
                    <span className="font-mono-nums text-sm text-slate-500">{c.checkin_date}</span>
                  </div>
                  {c.medication_taken && (
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Medication: {c.medication_taken}
                    </p>
                  )}
                  {c.note && <p className="text-sm text-slate-700 dark:text-slate-300">{c.note}</p>}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
