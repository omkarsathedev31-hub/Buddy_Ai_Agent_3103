import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, HelpCircle, Plus, Volume2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { speakText } from '../lib/speech.ts';

interface ReminderItem {
  id: string;
  category: string;
  title: string;
  message: string;
  scheduled_for: string;
  voice_enabled: number;
  delivery_status: 'scheduled' | 'sent' | 'acknowledged' | 'failed';
  created_by_name?: string;
}

export function RemindersHelpView({ initialTab = 'reminders' }: { initialTab?: 'reminders' | 'help' }) {
  const { user, settings } = useApp();
  const [tab, setTab] = useState<'reminders' | 'help'>(initialTab);
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('water');
  const [scheduledFor, setScheduledFor] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    return d.toISOString().slice(0, 16);
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    void loadReminders();
  }, []);

  async function loadReminders() {
    try {
      const res = await apiRequest<{ reminders: ReminderItem[] }>('/api/reminders');
      setReminders(res.reminders);
    } catch {
      // ignore
    }
  }

  async function createReminder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiRequest('/api/reminders', {
        method: 'POST',
        body: {
          category,
          title,
          message: title,
          scheduledFor: new Date(scheduledFor).toISOString(),
          voiceEnabled: true,
        },
      });
      setTitle('');
      await loadReminders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save reminder.');
    }
  }

  async function acknowledge(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/reminders/${id}/acknowledge`, { method: 'POST' });
      await loadReminders();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to mark reminder done.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">
            {tab === 'reminders' ? 'Daily Reminders' : 'Help & Emergency Guidance'}
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            {tab === 'reminders'
              ? 'Keep track of water, walks, appointments, and family calls.'
              : 'Simple help whenever you feel stuck or need immediate emergency numbers.'}
          </p>
        </div>

        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl self-start">
          <button
            type="button"
            onClick={() => setTab('reminders')}
            className={`min-h-[44px] px-4 rounded-xl font-semibold cursor-pointer ${
              tab === 'reminders' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Reminders
          </button>
          <button
            type="button"
            onClick={() => setTab('help')}
            className={`min-h-[44px] px-4 rounded-xl font-semibold cursor-pointer ${
              tab === 'help' ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            Help Guide
          </button>
        </div>
      </div>

      {tab === 'reminders' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-3">
            {reminders.length === 0 ? (
              <div className="p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <p className="text-slate-600 dark:text-slate-400">
                  No reminders scheduled yet. Add one on the right or ask an authorized caregiver to send reminders.
                </p>
              </div>
            ) : (
              reminders.map((r) => (
                <div
                  key={r.id}
                  className="p-5 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hc-surface flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Bell className="w-5 h-5 text-[#0F5156] dark:text-teal-400" />
                      <h2 className="font-display text-lg font-bold">{r.title}</h2>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-400 font-mono-nums">
                      {new Date(r.scheduled_for).toLocaleString()} · Status: {r.delivery_status}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        speakText(`Reminder: ${r.title}. ${r.message}`, {
                          language: user?.language ?? 'en',
                          speed: settings?.voice_speed ?? 'normal',
                        })
                      }
                      className="min-h-[44px] px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Volume2 className="w-4 h-4" />
                      <span>Listen</span>
                    </button>
                    {r.delivery_status !== 'acknowledged' && (
                      <button
                        type="button"
                        onClick={() => void acknowledge(r.id)}
                        className="min-h-[44px] px-4 rounded-xl bg-[#0F5156] text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>Mark Done</span>
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={createReminder}
            className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4 self-start"
          >
            <h2 className="font-display text-xl font-bold">Add Reminder</h2>
            {error && <p className="text-red-700 text-sm">{error}</p>}
            <div>
              <label htmlFor="rem-cat" className="block text-sm font-semibold mb-1">
                Category
              </label>
              <select
                id="rem-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="water">Drink Water</option>
                <option value="walk">Take a Walk</option>
                <option value="appointment">Appointment</option>
                <option value="call_family">Call Family</option>
                <option value="checkin">Daily Check-in</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label htmlFor="rem-title" className="block text-sm font-semibold mb-1">
                Reminder Note
              </label>
              <input
                id="rem-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Drink a glass of water"
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <div>
              <label htmlFor="rem-time" className="block text-sm font-semibold mb-1">
                Date &amp; Time
              </label>
              <input
                id="rem-time"
                type="datetime-local"
                required
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="w-full min-h-[48px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              />
            </div>
            <button
              type="submit"
              className="w-full min-h-[50px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              <span>Save Reminder</span>
            </button>
          </form>
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface space-y-5">
          <div className="flex items-start gap-3">
            <HelpCircle className="w-7 h-7 text-[#0F5156] dark:text-teal-400 shrink-0" />
            <div>
              <h2 className="font-display text-2xl font-bold">How Buddy Elder AI Helps You</h2>
              <p className="text-slate-600 dark:text-slate-400">
                Buddy Elder AI is an educational and daily assistance companion—not a hospital, bank, or police service.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-5 rounded-2xl border border-red-300 dark:border-red-800 bg-red-50/50 dark:bg-red-950/30 space-y-2">
              <h3 className="font-display text-lg font-bold">Urgent Physical or Medical Emergency</h3>
              <p>If you feel sudden chest pain, difficulty breathing, or physical danger, call official emergency services immediately:</p>
              <p className="font-mono-nums font-bold text-lg">India: 112 / 108 · US/Canada: 911 · UK: 999</p>
            </div>
            <div className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
              <h3 className="font-display text-lg font-bold">Financial or Cyber Fraud Helpline</h3>
              <p>If money was taken or you clicked a scam link, call your bank immediately and report cyber fraud (India Cyber Helpline: 1930).</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
