import React, { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  Info,
  Link2,
  Lock,
  Phone,
  RefreshCw,
  Send,
  Settings,
  Shield,
} from 'lucide-react';
import type { AlertSeverity, GranularPermissions, SharingLevel } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { BrandMark } from './BrandMark.tsx';
import { SettingsView } from './SettingsView.tsx';

interface CaregiverAlert {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  explanation: string;
  recommended_action: string;
  status: 'open' | 'reviewed' | 'resolved';
  created_at: string;
}

interface CaregiverReminder {
  id: string;
  category: string;
  title: string;
  message: string;
  scheduled_for: string;
  delivery_status: 'scheduled' | 'sent' | 'acknowledged' | 'failed';
  retry_count: number;
  last_error: string | null;
}

interface LinkedSeniorView {
  linkId: string;
  seniorId: string;
  seniorName: string;
  seniorLanguage: string;
  relationship: string;
  sharingLevel: SharingLevel;
  permissions: GranularPermissions;
  seniorPhone: string | null;
  latestCheckIn: {
    checkin_date: string;
    completed: boolean;
    mood?: string;
    medication_taken?: string | null;
    needs_help?: boolean | null;
    wants_family_call?: boolean | null;
    feels_safe?: boolean | null;
    note?: string | null;
  } | null;
  wellnessSummary: {
    checkInsLast7Days: number;
    completionRatePercent: number;
    moodCounts: { good: number; okay: number; not_good: number };
    history: Array<{ checkin_date: string; mood: string; medication_taken: string | null }>;
  } | null;
  alerts: CaregiverAlert[];
  reminders: CaregiverReminder[];
  activitySummary: { lessonsCompleted: number; totalLessons: number; scamChecksCount: number } | null;
  aiSummary: { conversationCount: number; note: string } | null;
  pendingRequests: Array<{ id: string; requested_level: SharingLevel; reason: string; status: string; created_at: string }>;
}

type CaregiverTab = 'overview' | 'alerts' | 'wellness' | 'reminders' | 'sharing' | 'settings';

const CAREGIVER_PATH_TO_TAB: Record<string, CaregiverTab> = {
  '/': 'overview',
  '/alerts': 'alerts',
  '/wellness': 'wellness',
  '/reminders': 'reminders',
  '/sharing': 'sharing',
  '/settings': 'settings',
};

const CAREGIVER_TAB_TO_PATH: Record<CaregiverTab, string> = {
  overview: '/',
  alerts: '/alerts',
  wellness: '/wellness',
  reminders: '/reminders',
  sharing: '/sharing',
  settings: '/settings',
};

function readInitialCaregiverTab(): CaregiverTab {
  if (typeof window === 'undefined') return 'overview';
  return CAREGIVER_PATH_TO_TAB[window.location.pathname] ?? 'overview';
}

export function CaregiverDashboard() {
  const { user, unreadCount, notifications, markNotificationRead, markAllNotificationsRead, logout } = useApp();
  const [tab, setTabState] = useState<CaregiverTab>(readInitialCaregiverTab);
  const [seniors, setSeniors] = useState<LinkedSeniorView[]>([]);
  const [selectedSeniorId, setSelectedSeniorId] = useState<string | null>(null);
  const [alertFilter, setAlertFilter] = useState<'all' | AlertSeverity>('all');
  const [selectedAlert, setSelectedAlert] = useState<CaregiverAlert | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);

  const [inviteCode, setInviteCode] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkSuccess, setLinkSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [remTitle, setRemTitle] = useState('');
  const [remCat, setRemCat] = useState('water');
  const [remTime, setRemTime] = useState(() => new Date(Date.now() + 3600_000).toISOString().slice(0, 16));

  const [reqLevel, setReqLevel] = useState<SharingLevel>('full');
  const [reqReason, setReqReason] = useState('');
  const [reqMsg, setReqMsg] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);

  function setTab(next: CaregiverTab) {
    setTabState(next);
    if (typeof window !== 'undefined') {
      const targetPath = CAREGIVER_TAB_TO_PATH[next];
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ caregiverTab: next }, '', targetPath);
      }
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!(window.location.pathname in CAREGIVER_PATH_TO_TAB)) {
      window.history.replaceState({ caregiverTab: 'overview' }, '', '/');
    }
    const onPop = () => {
      setTabState(readInitialCaregiverTab());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setLoading(true);
    try {
      const res = await apiRequest<{ seniors: LinkedSeniorView[] }>('/api/caregiver/dashboard');
      setSeniors(res.seniors);
      if (res.seniors.length > 0 && (!selectedSeniorId || !res.seniors.some((s) => s.seniorId === selectedSeniorId))) {
        setSelectedSeniorId(res.seniors[0].seniorId);
      }
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to load caregiver dashboard.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRedeemInvite(e: React.FormEvent) {
    e.preventDefault();
    setLinkError(null);
    setLinkSuccess(null);
    try {
      await apiRequest('/api/caregiver/link', {
        method: 'POST',
        body: { inviteCode },
      });
      setInviteCode('');
      setLinkSuccess('Senior linked successfully according to their sharing permissions.');
      await loadDashboard();
    } catch (err) {
      setLinkError(err instanceof ApiError ? err.message : 'Unable to link invite code.');
    }
  }

  async function updateAlertStatus(alertId: string, status: 'reviewed' | 'resolved') {
    setActionError(null);
    try {
      await apiRequest(`/api/caregiver/alerts/${alertId}/status`, {
        method: 'POST',
        body: { status },
      });
      setSelectedAlert((prev) => (prev && prev.id === alertId ? { ...prev, status } : prev));
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not update alert status.');
    }
  }

  async function createReminder(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSenior) return;
    setActionError(null);
    try {
      await apiRequest('/api/reminders', {
        method: 'POST',
        body: {
          seniorId: activeSenior.seniorId,
          category: remCat,
          title: remTitle,
          message: remTitle,
          scheduledFor: new Date(remTime).toISOString(),
          voiceEnabled: true,
        },
      });
      setRemTitle('');
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to schedule reminder.');
    }
  }

  async function deliverReminder(id: string, simulateFailure = false) {
    setActionError(null);
    try {
      await apiRequest(`/api/reminders/${id}/deliver`, {
        method: 'POST',
        body: { simulateFailure },
      });
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to deliver reminder.');
    }
  }

  async function submitSharingRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSenior) return;
    setReqMsg(null);
    setActionError(null);
    try {
      await apiRequest('/api/caregiver/permission-requests', {
        method: 'POST',
        body: {
          linkId: activeSenior.linkId,
          requestedLevel: reqLevel,
          reason: reqReason,
        },
      });
      setReqReason('');
      setReqMsg('Request sent to your family member. Only they can approve sharing changes.');
      await loadDashboard();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Unable to send permission request.');
    }
  }

  const activeSenior = seniors.find((s) => s.seniorId === selectedSeniorId) || seniors[0] || null;
  const filteredAlerts =
    activeSenior?.alerts.filter((a) => alertFilter === 'all' || a.severity === alertFilter) ?? [];

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <BrandMark className="w-8 h-8 shrink-0" />
            <span className="font-display text-lg font-bold">Buddy Elder AI</span>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-600 dark:text-slate-300">
            {(
              [
                ['overview', 'Overview'],
                ['alerts', 'Alerts'],
                ['wellness', 'Wellness'],
                ['reminders', 'Reminders'],
                ['sharing', 'Permissions'],
                ['settings', 'Settings'],
              ] as Array<[CaregiverTab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`whitespace-nowrap shrink-0 cursor-pointer ${
                  tab === key ? 'text-[#0F5156] dark:text-teal-400 underline underline-offset-8' : 'hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowNotifs((v) => !v)}
              aria-label="Notifications"
              className="min-h-[40px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 font-semibold text-sm inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              <span className="font-mono-nums">{unreadCount}</span>
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-[40px] px-4 rounded-lg bg-slate-900 dark:bg-slate-800 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="md:hidden flex gap-1.5 overflow-x-auto px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        {(['overview', 'alerts', 'wellness', 'reminders', 'sharing', 'settings'] as CaregiverTab[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`px-3 py-2 rounded-lg text-sm font-semibold capitalize whitespace-nowrap shrink-0 cursor-pointer ${
              tab === key ? 'bg-[#0F5156] text-white' : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            {key}
          </button>
        ))}
      </div>

      {showNotifs && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold">Notifications</h2>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllNotificationsRead()}
                  className="text-sm font-semibold text-[#0F5156] cursor-pointer"
                >
                  Mark all read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-500">No notifications.</p>
            ) : (
              notifications.slice(0, 8).map((n) => (
                <div key={n.id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <p className="font-semibold">{n.title}</p>
                    <p className="text-slate-600 dark:text-slate-400">{n.body}</p>
                  </div>
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={() => void markNotificationRead(n.id)}
                      className="text-xs font-semibold text-[#0F5156] cursor-pointer"
                    >
                      Read
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-[#0F5156] dark:text-teal-400">Family &amp; Caregiver Portal</p>
            <h1 className="font-display text-2xl sm:text-3xl font-bold">Welcome, {user?.name}</h1>
          </div>

          <form onSubmit={handleRedeemInvite} className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="Enter Senior Invite Code (BE-...)"
              aria-label="Senior Invite Code"
              className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono-nums uppercase"
            />
            <button
              type="submit"
              className="min-h-[44px] px-5 rounded-xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold inline-flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
            >
              <Link2 className="w-4 h-4" />
              <span>Link Senior</span>
            </button>
          </form>
        </div>

        {linkError && (
          <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm">
            {linkError}
          </div>
        )}
        {actionError && (
          <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-300 text-red-900 text-sm">
            {actionError}
          </div>
        )}
        {linkSuccess && (
          <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-sm">
            {linkSuccess}
          </div>
        )}

        {tab === 'settings' ? (
          <SettingsView />
        ) : loading ? (
          <p className="text-slate-500">Loading caregiver dashboard...</p>
        ) : !activeSenior ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center space-y-3">
            <Shield className="w-10 h-10 mx-auto text-[#0F5156]" />
            <h2 className="font-display text-xl font-bold">No Linked Senior Yet</h2>
            <p className="text-slate-600 dark:text-slate-400 max-w-lg mx-auto">
              Ask your senior family member to generate an invite code in their <strong>Family &amp; Permissions</strong> screen and enter it above to view the information they choose to share.
            </p>
          </div>
        ) : (
          <>
            {/* Senior Switcher */}
            {seniors.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {seniors.map((s) => (
                  <button
                    key={s.seniorId}
                    type="button"
                    onClick={() => setSelectedSeniorId(s.seniorId)}
                    className={`min-h-[44px] px-4 rounded-xl border font-semibold cursor-pointer ${
                      activeSenior.seniorId === s.seniorId
                        ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40 text-[#0F5156]'
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                    }`}
                  >
                    {s.seniorName} ({s.relationship})
                  </button>
                ))}
              </div>
            )}

            {tab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-1">
                    <p className="text-sm text-slate-500">Senior Profile</p>
                    <p className="font-display text-xl font-bold">{activeSenior.seniorName}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 capitalize">
                      {activeSenior.relationship} · Sharing: {activeSenior.sharingLevel}
                    </p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-1">
                    <p className="text-sm text-slate-500">Last Check-in</p>
                    {activeSenior.permissions.checkin_status ? (
                      activeSenior.latestCheckIn ? (
                        <>
                          <p className="font-display text-xl font-bold font-mono-nums">
                            {activeSenior.latestCheckIn.checkin_date}
                          </p>
                          <p className="text-sm text-slate-600 dark:text-slate-400 capitalize">
                            {activeSenior.permissions.checkin_responses && activeSenior.latestCheckIn.mood
                              ? `Mood: ${activeSenior.latestCheckIn.mood.replace('_', ' ')}`
                              : 'Completed (details hidden by preference)'}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm text-slate-500">No check-ins recorded yet</p>
                      )
                    ) : (
                      <p className="text-sm text-slate-500 flex items-center gap-1">
                        <Lock className="w-4 h-4" /> Not shared by senior
                      </p>
                    )}
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-1">
                    <p className="text-sm text-slate-500">Open Permitted Alerts</p>
                    <p className="font-display text-2xl font-bold font-mono-nums">
                      {activeSenior.alerts.filter((a) => a.status !== 'resolved').length}
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      Filtered by senior permissions
                    </p>
                  </div>

                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 space-y-1">
                    <p className="text-sm text-slate-500">Contact &amp; Activity</p>
                    {activeSenior.seniorPhone ? (
                      <a
                        href={`tel:${activeSenior.seniorPhone}`}
                        className="inline-flex items-center gap-1.5 font-semibold text-[#0F5156] dark:text-teal-400 font-mono-nums"
                      >
                        <Phone className="w-4 h-4" />
                        <span>{activeSenior.seniorPhone}</span>
                      </a>
                    ) : (
                      <p className="text-sm text-slate-500">Phone not shared</p>
                    )}
                    {activeSenior.activitySummary && (
                      <p className="text-sm text-slate-600 dark:text-slate-400 font-mono-nums">
                        Lessons: {activeSenior.activitySummary.lessonsCompleted}/{activeSenior.activitySummary.totalLessons}
                      </p>
                    )}
                  </div>
                </div>

                {activeSenior.aiSummary && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5">
                    <h2 className="font-display font-bold">AI Assistant Summary</h2>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                      Total conversations: <span className="font-mono-nums font-semibold">{activeSenior.aiSummary.conversationCount}</span> · {activeSenior.aiSummary.note}
                    </p>
                  </div>
                )}
              </div>
            )}

            {tab === 'alerts' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 space-y-4">
                  <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl self-start">
                    {(['all', 'critical', 'warning', 'informational'] as const).map((sev) => (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => setAlertFilter(sev)}
                        className={`min-h-[40px] px-3.5 rounded-lg text-sm font-semibold capitalize cursor-pointer ${
                          alertFilter === sev ? 'bg-white dark:bg-slate-900 shadow-sm' : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {sev}
                      </button>
                    ))}
                  </div>

                  {filteredAlerts.length === 0 ? (
                    <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <p className="text-slate-600 dark:text-slate-400">No permitted alerts match this filter.</p>
                    </div>
                  ) : (
                    filteredAlerts.map((al) => (
                      <button
                        key={al.id}
                        type="button"
                        onClick={() => setSelectedAlert(al)}
                        className={`w-full text-left p-5 rounded-2xl border space-y-1.5 cursor-pointer ${
                          selectedAlert?.id === al.id
                            ? 'border-[#0F5156] bg-teal-50/50 dark:bg-teal-950/30'
                            : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 text-sm font-bold uppercase">
                            {al.severity === 'critical' ? (
                              <AlertOctagon className="w-4 h-4 text-red-600" />
                            ) : al.severity === 'warning' ? (
                              <AlertTriangle className="w-4 h-4 text-amber-600" />
                            ) : (
                              <Info className="w-4 h-4 text-teal-600" />
                            )}
                            <span>{al.severity}</span>
                          </span>
                          <span className="text-xs font-mono-nums text-slate-500">
                            {al.status} · {new Date(al.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        <h3 className="font-display font-bold text-lg">{al.title}</h3>
                        <p className="text-sm text-slate-600 dark:text-slate-400">{al.description}</p>
                      </button>
                    ))
                  )}
                </div>

                <aside className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 self-start">
                  {selectedAlert ? (
                    <>
                      <h2 className="font-display text-xl font-bold">{selectedAlert.title}</h2>
                      <p className="text-sm font-mono-nums text-slate-500">
                        {selectedAlert.severity.toUpperCase()} · {new Date(selectedAlert.created_at).toLocaleString()} · Status: {selectedAlert.status}
                      </p>
                      <p>{selectedAlert.description}</p>
                      <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm space-y-1">
                        <p className="font-semibold">Explanation</p>
                        <p>{selectedAlert.explanation}</p>
                      </div>
                      <div className="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 text-sm space-y-1">
                        <p className="font-semibold">Recommended Action</p>
                        <p>{selectedAlert.recommended_action}</p>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-2">
                        {activeSenior.seniorPhone && (
                          <a
                            href={`tel:${activeSenior.seniorPhone}`}
                            className="min-h-[44px] px-4 rounded-xl bg-[#0F5156] text-white font-semibold inline-flex items-center gap-1.5"
                          >
                            <Phone className="w-4 h-4" />
                            <span>Call {activeSenior.seniorName}</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => void updateAlertStatus(selectedAlert.id, 'reviewed')}
                          className="min-h-[44px] px-4 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold cursor-pointer"
                        >
                          Mark Reviewed
                        </button>
                        <button
                          type="button"
                          onClick={() => void updateAlertStatus(selectedAlert.id, 'resolved')}
                          className="min-h-[44px] px-4 rounded-xl bg-emerald-700 text-white font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>Resolve</span>
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="text-slate-500">Select an alert to inspect details and actions.</p>
                  )}
                </aside>
              </div>
            )}

            {tab === 'wellness' && (
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-bold">Authorized Wellness Summary</h2>
                  <p className="text-xs text-slate-500">Informational summary only — not a medical diagnosis</p>
                </div>

                {!activeSenior.wellnessSummary ? (
                  <p className="text-slate-500">
                    Wellness summaries are not shared under {activeSenior.seniorName}&apos;s current permissions.
                  </p>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                        <p className="text-xs text-slate-500">7-Day Check-ins</p>
                        <p className="font-display text-2xl font-bold font-mono-nums">
                          {activeSenior.wellnessSummary.checkInsLast7Days}
                        </p>
                      </div>
                      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                        <p className="text-xs text-slate-500">Completion Rate</p>
                        <p className="font-display text-2xl font-bold font-mono-nums">
                          {activeSenior.wellnessSummary.completionRatePercent}%
                        </p>
                      </div>
                      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                        <p className="text-xs text-slate-500">Good / Okay Days</p>
                        <p className="font-display text-2xl font-bold font-mono-nums">
                          {activeSenior.wellnessSummary.moodCounts.good} / {activeSenior.wellnessSummary.moodCounts.okay}
                        </p>
                      </div>
                      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                        <p className="text-xs text-slate-500">Not Good Days</p>
                        <p className="font-display text-2xl font-bold font-mono-nums">
                          {activeSenior.wellnessSummary.moodCounts.not_good}
                        </p>
                      </div>
                    </div>

                    {activeSenior.wellnessSummary.history.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="font-semibold">Recent Authorized Check-ins</h3>
                        {activeSenior.wellnessSummary.history.map((item) => (
                          <div key={item.checkin_date} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-800 text-sm">
                            <span className="font-mono-nums">{item.checkin_date}</span>
                            <span className="capitalize font-semibold">{item.mood.replace('_', ' ')}</span>
                            <span className="text-slate-500">Med: {item.medication_taken ?? 'n/a'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tab === 'reminders' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 space-y-3">
                  <h2 className="font-display text-xl font-bold">Senior Reminders</h2>
                  {!activeSenior.permissions.reminder_status ? (
                    <p className="text-slate-500">Reminder management is disabled by {activeSenior.seniorName}&apos;s privacy settings.</p>
                  ) : activeSenior.reminders.length === 0 ? (
                    <p className="text-slate-500">No reminders created yet.</p>
                  ) : (
                    activeSenior.reminders.map((r) => (
                      <div key={r.id} className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <p className="font-bold flex items-center gap-1.5">
                            <CalendarClock className="w-4 h-4 text-[#0F5156]" />
                            <span>{r.title}</span>
                          </p>
                          <p className="text-xs font-mono-nums text-slate-500">
                            {new Date(r.scheduled_for).toLocaleString()} · Status: {r.delivery_status} · Retries: {r.retry_count}
                          </p>
                          {r.last_error && <p className="text-xs text-red-600 mt-1">{r.last_error}</p>}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void deliverReminder(r.id, false)}
                            className="min-h-[40px] px-3 rounded-lg bg-[#0F5156] text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{r.delivery_status === 'failed' ? 'Retry Send' : 'Send Now'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void deliverReminder(r.id, true)}
                            className="min-h-[40px] px-3 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-semibold cursor-pointer"
                          >
                            Test Failure
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {activeSenior.permissions.reminder_status && (
                  <form
                    onSubmit={createReminder}
                    className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 self-start"
                  >
                    <h2 className="font-display text-lg font-bold">Schedule Reminder</h2>
                    <div>
                      <label htmlFor="cg-rem-cat" className="block text-sm font-semibold mb-1">
                        Preset Type
                      </label>
                      <select
                        id="cg-rem-cat"
                        value={remCat}
                        onChange={(e) => setRemCat(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      >
                        <option value="water">Drink Water</option>
                        <option value="walk">Take a Walk</option>
                        <option value="appointment">Appointment</option>
                        <option value="call_family">Call Family</option>
                        <option value="checkin">Check In</option>
                        <option value="custom">Custom</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="cg-rem-title" className="block text-sm font-semibold mb-1">
                        Message
                      </label>
                      <input
                        id="cg-rem-title"
                        required
                        value={remTitle}
                        onChange={(e) => setRemTitle(e.target.value)}
                        placeholder="e.g. Evening walk at 5 PM"
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label htmlFor="cg-rem-time" className="block text-sm font-semibold mb-1">
                        Schedule Time
                      </label>
                      <input
                        id="cg-rem-time"
                        type="datetime-local"
                        required
                        value={remTime}
                        onChange={(e) => setRemTime(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full min-h-[48px] rounded-xl bg-[#0F5156] text-white font-semibold cursor-pointer"
                    >
                      Schedule Reminder
                    </button>
                  </form>
                )}
              </div>
            )}

            {tab === 'sharing' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-3">
                  <h2 className="font-display text-xl font-bold">Current Authorized Permissions</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    Sharing Level: <strong className="capitalize">{activeSenior.sharingLevel}</strong> (controlled exclusively by {activeSenior.seniorName})
                  </p>
                  <ul className="space-y-2 text-sm">
                    {Object.entries(activeSenior.permissions).map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800">
                        <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                        <span className={v ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : 'text-slate-500'}>
                          {v ? 'Allowed' : 'Hidden'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <form
                  onSubmit={submitSharingRequest}
                  className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 self-start"
                >
                  <h2 className="font-display text-xl font-bold">Request Additional Sharing Access</h2>
                  <p className="text-sm text-slate-600 dark:text-slate-400">
                    You can ask {activeSenior.seniorName} for a higher sharing level. They will review and decide whether to approve it.
                  </p>
                  <div>
                    <label htmlFor="req-lvl" className="block text-sm font-semibold mb-1">
                      Requested Level
                    </label>
                    <select
                      id="req-lvl"
                      value={reqLevel}
                      onChange={(e) => setReqLevel(e.target.value as SharingLevel)}
                      className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    >
                      <option value="balanced">Balanced</option>
                      <option value="full">Full</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="req-reason" className="block text-sm font-semibold mb-1">
                      Why do you need this access?
                    </label>
                    <textarea
                      id="req-reason"
                      required
                      rows={3}
                      value={reqReason}
                      onChange={(e) => setReqReason(e.target.value)}
                      placeholder="e.g. So I can help remind you about doctor visits."
                      className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
                    />
                  </div>
                  {reqMsg && <p className="text-sm font-semibold text-[#0F5156] dark:text-teal-400">{reqMsg}</p>}
                  <button
                    type="submit"
                    className="w-full min-h-[48px] rounded-xl bg-[#0F5156] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    <span>Send Request to Senior</span>
                  </button>
                </form>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
