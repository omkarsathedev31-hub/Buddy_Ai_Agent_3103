import React, { useEffect, useState } from 'react';
import { ShieldCheck, Users } from 'lucide-react';
import type { PublicUser, UserRole } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { BrandMark } from './BrandMark.tsx';

interface AdminOverview {
  stats: {
    totalUsers: number;
    seniors: number;
    caregivers: number;
    admins: number;
    totalCheckIns: number;
    openAlerts: number;
    scamAssessments: number;
    lessonsCompleted: number;
    feedbackCount: number;
  };
  ai: { configured: boolean; model: string; fallbackModel?: string | null };
  messaging: {
    configured: boolean;
    number: string | null;
    source?: 'env' | 'database' | 'none';
    error?: string | null;
  };
  database?: {
    engine: string;
    durable: boolean;
    mode: string;
    warning: string | null;
  };
}

export function AdminDashboard() {
  const { user, logout } = useApp();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [feedback, setFeedback] = useState<Array<{ id: string; user_name: string; user_role: string; category: string; rating: number; message: string; created_at: string }>>([]);
  const [msgNumberInput, setMsgNumberInput] = useState('');
  const [msgNotice, setMsgNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    try {
      const [ov, usr, fb] = await Promise.all([
        apiRequest<AdminOverview>('/api/admin/overview'),
        apiRequest<{ users: PublicUser[] }>('/api/admin/users'),
        apiRequest<{ feedback: Array<{ id: string; user_name: string; user_role: string; category: string; rating: number; message: string; created_at: string }> }>('/api/feedback'),
      ]);
      setOverview(ov);
      setMsgNumberInput(ov.messaging.number ?? '');
      setUsers(usr.users);
      setFeedback(fb.feedback);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load admin console.');
    }
  }

  async function updateUser(id: string, patch: { isActive?: boolean; role?: UserRole }) {
    setError(null);
    try {
      await apiRequest(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: patch,
      });
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update user.');
    }
  }

  async function saveMessagingNumber(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMsgNotice(null);
    try {
      const res = await apiRequest<{
        configured: boolean;
        number: string | null;
        source?: 'env' | 'database' | 'none';
        envOverride?: boolean;
      }>('/api/admin/messaging-config', {
        method: 'PUT',
        body: { messagingNumber: msgNumberInput },
      });
      if (res.envOverride) {
        setMsgNotice(
          `Database fallback updated, while BUDDY_MESSAGING_NUMBER from server environment remains active (${res.number ?? 'invalid'}).`
        );
      } else {
        setMsgNotice(
          res.configured ? `Messaging number updated to ${res.number}` : 'Messaging number cleared (unconfigured).'
        );
      }
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update messaging config.');
    }
  }

  const filteredUsers = users.filter(
    (u) =>
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5">
            <BrandMark className="w-8 h-8" />
            <span className="font-display text-lg font-bold">Buddy Elder AI · Admin Console</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600 dark:text-slate-400 hidden sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-[40px] px-4 rounded-lg bg-slate-900 text-white text-sm font-semibold cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {error && (
          <div role="alert" className="p-4 rounded-xl bg-red-50 border border-red-300 text-red-900">
            {error}
          </div>
        )}

        {overview && (
          <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
            {[
              ['Total Users', overview.stats.totalUsers],
              ['Seniors / Caregivers', `${overview.stats.seniors} / ${overview.stats.caregivers}`],
              ['Check-ins Logged', overview.stats.totalCheckIns],
              ['Open Safety Alerts', overview.stats.openAlerts],
              ['Lessons Completed', overview.stats.lessonsCompleted],
            ].map(([label, val]) => (
              <div key={String(label)} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="font-display text-2xl font-bold font-mono-nums mt-1">{val}</p>
              </div>
            ))}
          </section>
        )}

        {/* Integration & Messaging Configuration */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={saveMessagingNumber}
            className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#0F5156]" />
              <h2 className="font-display text-lg font-bold">Messaging Number &amp; Integration Status</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              AI Status:{' '}
              <strong>
                {overview?.ai.configured
                  ? `Configured (Primary: ${overview.ai.model}${overview.ai.fallbackModel ? ` · Fallback: ${overview.ai.fallbackModel}` : ''})`
                  : 'GEMINI_API_KEY not set'}
              </strong>
            </p>
            {overview && !overview.messaging.configured && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-sm text-amber-900 dark:text-amber-200">
                {overview.messaging.error ||
                  'BUDDY_MESSAGING_NUMBER is not configured. Set it in server environment variables or save a number with country code below.'}
              </div>
            )}
            {overview?.messaging.source === 'env' && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Currently using <code>BUDDY_MESSAGING_NUMBER</code> from server environment variables.
              </p>
            )}
            {overview?.database && !overview.database.durable && overview.database.warning && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                {overview.database.warning}
              </div>
            )}
            <div>
              <label htmlFor="adm-msg-num" className="block text-sm font-semibold mb-1">
                Buddy Elder AI Messaging Number (with country code, e.g. +[country code][number])
              </label>
              <div className="flex gap-2">
                <input
                  id="adm-msg-num"
                  value={msgNumberInput}
                  onChange={(e) => setMsgNumberInput(e.target.value)}
                  placeholder="Include country code starting with + (leave blank if unconfigured)"
                  className="flex-1 min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 font-mono-nums"
                />
                <button
                  type="submit"
                  className="min-h-[44px] px-5 rounded-xl bg-[#0F5156] text-white font-semibold cursor-pointer"
                >
                  Save
                </button>
              </div>
            </div>
            {msgNotice && <p className="text-sm font-semibold text-[#0F5156]">{msgNotice}</p>}
          </form>

          <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
            <h2 className="font-display text-lg font-bold">Recent User Feedback ({feedback.length})</h2>
            {feedback.length === 0 ? (
              <p className="text-sm text-slate-500">No feedback submitted yet.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto text-sm">
                {feedback.map((f) => (
                  <div key={f.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                    <div className="flex justify-between font-semibold">
                      <span>{f.user_name} ({f.user_role})</span>
                      <span className="font-mono-nums">{f.rating}/5 · {f.category}</span>
                    </div>
                    <p className="text-slate-600 dark:text-slate-400 mt-1">{f.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* User Management */}
        <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#0F5156]" />
              <h2 className="font-display text-xl font-bold">User Management</h2>
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by name or email..."
              className="min-h-[42px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th className="py-2.5 pr-4">Name</th>
                  <th className="py-2.5 pr-4">Email</th>
                  <th className="py-2.5 pr-4">Role</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-3 pr-4 font-semibold">{u.name}</td>
                    <td className="py-3 pr-4 font-mono-nums">{u.email}</td>
                    <td className="py-3 pr-4">
                      <select
                        aria-label={`Role for ${u.name}`}
                        value={u.role}
                        disabled={u.id === user?.id}
                        onChange={(e) => void updateUser(u.id, { role: e.target.value as UserRole })}
                        className="min-h-[36px] px-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="senior">senior</option>
                        <option value="caregiver">caregiver</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={u.is_active ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-red-600 font-semibold'}>
                        {u.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        disabled={u.id === user?.id}
                        onClick={() => void updateUser(u.id, { isActive: !u.is_active })}
                        className="min-h-[36px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold disabled:opacity-40 cursor-pointer"
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
