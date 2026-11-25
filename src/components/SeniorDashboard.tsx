import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Bell,
  BookOpen,
  HeartPulse,
  HelpCircle,
  MessageCircle,
  MessageSquare,
  PhoneCall,
  Settings,
  ShieldCheck,
  Users,
  Volume2,
} from 'lucide-react';
import { useApp } from '../contexts/AppContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { LANGUAGE_LABELS, t } from '../lib/i18n.ts';
import { AiBuddyView } from './AiBuddyView.tsx';
import { AudioReaderView } from './AudioReaderView.tsx';
import { SeniorVoiceSetupModal } from './AuthOnboarding.tsx';
import { BrandMark } from './BrandMark.tsx';
import { DailyCheckinView } from './DailyCheckinView.tsx';
import { FamilyPermissionsView } from './FamilyPermissionsView.tsx';
import { LearnTechView } from './LearnTechView.tsx';
import { MessagingOnboardingView } from './MessagingOnboardingView.tsx';
import { RemindersHelpView } from './RemindersHelpView.tsx';
import { ScamSafetyView } from './ScamSafetyView.tsx';
import { SettingsView } from './SettingsView.tsx';

type SeniorRoute =
  | 'home'
  | 'ai_buddy'
  | 'is_this_safe'
  | 'read_this'
  | 'daily_checkin'
  | 'family'
  | 'call_family'
  | 'learn_tech'
  | 'reminders'
  | 'messaging'
  | 'help'
  | 'settings';

const SENIOR_PATH_TO_ROUTE: Record<string, SeniorRoute> = {
  '/': 'home',
  '/ai-buddy': 'ai_buddy',
  '/is-this-safe': 'is_this_safe',
  '/read-this': 'read_this',
  '/daily-checkin': 'daily_checkin',
  '/family': 'family',
  '/call-family': 'call_family',
  '/learn-tech': 'learn_tech',
  '/reminders': 'reminders',
  '/messaging': 'messaging',
  '/help': 'help',
  '/settings': 'settings',
};

const SENIOR_ROUTE_TO_PATH: Record<SeniorRoute, string> = {
  home: '/',
  ai_buddy: '/ai-buddy',
  is_this_safe: '/is-this-safe',
  read_this: '/read-this',
  daily_checkin: '/daily-checkin',
  family: '/family',
  call_family: '/call-family',
  learn_tech: '/learn-tech',
  reminders: '/reminders',
  messaging: '/messaging',
  help: '/help',
  settings: '/settings',
};

function readInitialSeniorRoute(): SeniorRoute {
  if (typeof window === 'undefined') return 'home';
  return SENIOR_PATH_TO_ROUTE[window.location.pathname] ?? 'home';
}

export function SeniorDashboard() {
  const { user, settings, notifications, unreadCount, markNotificationRead, markAllNotificationsRead, logout } = useApp();
  const [route, setRouteState] = useState<SeniorRoute>(readInitialSeniorRoute);
  const [showNotifications, setShowNotifications] = useState(false);
  const [todayCheckedIn, setTodayCheckedIn] = useState<boolean>(false);
  const [lessonsSummary, setLessonsSummary] = useState<{ completed: number; total: number }>({ completed: 0, total: 6 });

  const lang = user?.language ?? 'en';

  function setRoute(next: SeniorRoute) {
    setRouteState(next);
    if (typeof window !== 'undefined') {
      const targetPath = SENIOR_ROUTE_TO_PATH[next];
      if (window.location.pathname !== targetPath) {
        window.history.pushState({ seniorRoute: next }, '', targetPath);
      }
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!(window.location.pathname in SENIOR_PATH_TO_ROUTE)) {
      window.history.replaceState({ seniorRoute: 'home' }, '', '/');
    }
    const onPop = () => {
      setRouteState(readInitialSeniorRoute());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [route]);

  async function loadSummary() {
    try {
      const [ciRes, lesRes] = await Promise.all([
        apiRequest<{ todayCheckIn: unknown | null }>('/api/checkins'),
        apiRequest<{ completedCount: number; totalCount: number }>('/api/lessons'),
      ]);
      setTodayCheckedIn(Boolean(ciRes.todayCheckIn));
      setLessonsSummary({ completed: lesRes.completedCount, total: lesRes.totalCount });
    } catch {
      // ignore
    }
  }

  if (!user || !settings) return null;

  if (!settings.onboarding_completed) {
    return (
      <div className="min-h-screen bg-[#FAF8F5] dark:bg-slate-950 px-4 py-6">
        <SeniorVoiceSetupModal onComplete={() => setRoute('home')} />
      </div>
    );
  }

  const tiles: Array<{
    id: SeniorRoute;
    title: string;
    desc: string;
    icon: typeof MessageCircle;
    highlight?: boolean;
  }> = [
    { id: 'ai_buddy', title: t(lang, 'aiBuddy'), desc: t(lang, 'aiBuddyDesc'), icon: MessageCircle, highlight: true },
    { id: 'is_this_safe', title: t(lang, 'isThisSafe'), desc: t(lang, 'isThisSafeDesc'), icon: ShieldCheck },
    { id: 'read_this', title: t(lang, 'readThis'), desc: t(lang, 'readThisDesc'), icon: Volume2 },
    { id: 'daily_checkin', title: t(lang, 'dailyCheckin'), desc: t(lang, 'dailyCheckinDesc'), icon: HeartPulse },
    { id: 'family', title: t(lang, 'family'), desc: t(lang, 'familyDesc'), icon: Users },
    { id: 'call_family', title: t(lang, 'callFamily'), desc: t(lang, 'callFamilyDesc'), icon: PhoneCall },
    { id: 'learn_tech', title: t(lang, 'learnTech'), desc: t(lang, 'learnTechDesc'), icon: BookOpen },
    { id: 'reminders', title: t(lang, 'reminders'), desc: t(lang, 'remindersDesc'), icon: Bell },
    { id: 'messaging', title: t(lang, 'messagingSetup'), desc: t(lang, 'messagingSetupDesc'), icon: MessageSquare },
    { id: 'help', title: 'Help & Emergency', desc: 'Emergency phone numbers & simple guides', icon: HelpCircle },
    { id: 'settings', title: t(lang, 'helpSettings'), desc: t(lang, 'helpSettingsDesc'), icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-[#FAF8F5] dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
          <button
            type="button"
            onClick={() => setRoute('home')}
            className="flex items-center gap-2.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BrandMark className="w-8 h-8 shrink-0" />
            <span className="font-display text-lg font-bold tracking-tight">{t(lang, 'brand')}</span>
          </button>

          <nav className="hidden md:flex items-center gap-6 text-sm font-semibold text-slate-700 dark:text-slate-300">
            <button type="button" onClick={() => setRoute('home')} className="hover:text-[#0F5156] whitespace-nowrap shrink-0 cursor-pointer">
              Home
            </button>
            <button type="button" onClick={() => setRoute('ai_buddy')} className="hover:text-[#0F5156] whitespace-nowrap shrink-0 cursor-pointer">
              {t(lang, 'aiBuddy')}
            </button>
            <button type="button" onClick={() => setRoute('is_this_safe')} className="hover:text-[#0F5156] whitespace-nowrap shrink-0 cursor-pointer">
              {t(lang, 'isThisSafe')}
            </button>
            <button type="button" onClick={() => setRoute('family')} className="hover:text-[#0F5156] whitespace-nowrap shrink-0 cursor-pointer">
              Family
            </button>
            <button type="button" onClick={() => setRoute('settings')} className="hover:text-[#0F5156] whitespace-nowrap shrink-0 cursor-pointer">
              Settings
            </button>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowNotifications((s) => !s)}
              aria-label={`Notifications (${unreadCount} unread)`}
              className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              <span className="font-mono-nums">{unreadCount}</span>
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 dark:bg-slate-800 text-white text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              {t(lang, 'signOut')}
            </button>
          </div>
        </div>
      </header>

      {showNotifications && (
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 pt-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 hc-surface space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Notifications</h2>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllNotificationsRead()}
                  className="text-sm font-semibold text-[#0F5156] dark:text-teal-400 cursor-pointer"
                >
                  Mark All Read
                </button>
              )}
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-slate-500">No notifications right now.</p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`p-3 rounded-2xl border flex items-start justify-between gap-3 ${
                      n.is_read ? 'border-slate-200 dark:border-slate-800 opacity-75' : 'border-[#0F5156] bg-teal-50/40 dark:bg-teal-950/30'
                    }`}
                  >
                    <div>
                      <p className="font-semibold text-sm">{n.title}</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">{n.body}</p>
                    </div>
                    {!n.is_read && (
                      <button
                        type="button"
                        onClick={() => void markNotificationRead(n.id)}
                        className="text-xs font-semibold text-[#0F5156] dark:text-teal-400 shrink-0 cursor-pointer"
                      >
                        Mark Read
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {route !== 'home' && (
          <div className="mb-6">
            <button
              type="button"
              onClick={() => setRoute('home')}
              className="min-h-[48px] px-5 rounded-2xl border-2 border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>{t(lang, 'backHome')}</span>
            </button>
          </div>
        )}

        {route === 'home' && (
          <div className="space-y-8">
            <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-[#0F5156] dark:text-teal-400">
                  {LANGUAGE_LABELS[lang].native} · {t(lang, 'tagline')}
                </p>
                <h1 className="font-display text-3xl sm:text-4xl font-bold">
                  {t(lang, 'homeGreeting')}, {user.name}
                </h1>
                <p className="text-slate-600 dark:text-slate-400 text-lg">
                  {todayCheckedIn
                    ? 'You have completed today’s daily check-in.'
                    : 'How are you feeling today? Tap Daily Check-in whenever you are ready.'}
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setRoute('daily_checkin')}
                  className="min-h-[54px] px-6 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold cursor-pointer"
                >
                  {todayCheckedIn ? 'Update Daily Check-in' : 'Complete Daily Check-in'}
                </button>
                <button
                  type="button"
                  onClick={() => setRoute('learn_tech')}
                  className="min-h-[54px] px-6 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold font-mono-nums cursor-pointer"
                >
                  Lessons: {lessonsSummary.completed}/{lessonsSummary.total}
                </button>
              </div>
            </section>

            <section aria-label="Main Senior Features" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => setRoute(tile.id)}
                    className={`min-h-[124px] p-6 rounded-3xl border text-left transition-colors cursor-pointer flex items-start gap-4 hc-surface ${
                      tile.highlight
                        ? 'bg-[#0F5156] text-white border-[#0F5156] hover:bg-[#0c4246]'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-[#0F5156]'
                    }`}
                  >
                    <div
                      className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                        tile.highlight
                          ? 'bg-white/15 text-white'
                          : 'bg-[#F3F0EA] dark:bg-slate-800 text-[#0F5156] dark:text-teal-400'
                      }`}
                    >
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="space-y-1">
                      <h2 className="font-display text-xl font-bold">{tile.title}</h2>
                      <p className={`text-sm ${tile.highlight ? 'text-teal-100' : 'text-slate-600 dark:text-slate-400'}`}>
                        {tile.desc}
                      </p>
                    </div>
                  </button>
                );
              })}
            </section>
          </div>
        )}

        {route === 'ai_buddy' && <AiBuddyView />}
        {route === 'is_this_safe' && <ScamSafetyView onNavigateHome={() => setRoute('home')} />}
        {route === 'read_this' && <AudioReaderView />}
        {route === 'daily_checkin' && <DailyCheckinView onCheckinSaved={() => void loadSummary()} />}
        {route === 'family' && <FamilyPermissionsView initialSection="permissions" />}
        {route === 'call_family' && <FamilyPermissionsView initialSection="call" />}
        {route === 'learn_tech' && <LearnTechView />}
        {route === 'reminders' && <RemindersHelpView initialTab="reminders" />}
        {route === 'help' && <RemindersHelpView initialTab="help" />}
        {route === 'messaging' && <MessagingOnboardingView />}
        {route === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}
