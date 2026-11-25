import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PublicUser, SupportedLanguage, UserSettings } from '../../shared/types.ts';
import {
  ApiError,
  apiRequest,
  bumpAuthGeneration,
  checkBackendHealth,
  getApiBaseConfig,
  setAuthToken,
  setOnUnauthorizedHandler,
  type BackendHealthResponse,
} from '../lib/api.ts';

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface AdminSetupStatus {
  hasEnvPasscode: boolean;
  hasClaimedPasscode: boolean;
  hasAdminUser: boolean;
}

export interface BackendHealthState {
  status: 'checking' | 'healthy' | 'degraded' | 'unavailable';
  error: string | null;
  apiBaseUrl: string;
  details?: BackendHealthResponse;
}

interface AppContextValue {
  user: PublicUser | null;
  settings: UserSettings | null;
  adminSetup: AdminSetupStatus;
  backendHealth: BackendHealthState;
  loading: boolean;
  guestLanguage: SupportedLanguage;
  setGuestLanguage: (lang: SupportedLanguage) => void;
  notifications: NotificationItem[];
  unreadCount: number;
  sessionNotice: string | null;
  clearSessionNotice: () => void;
  refreshSession: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  setAuthData: (user: PublicUser, settings: UserSettings, token?: string) => void;
  updateSettings: (patch: Partial<UserSettings> & { name?: string; phone?: string; language?: SupportedLanguage }) => Promise<void>;
  logout: (options?: { skipServer?: boolean }) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [adminSetup, setAdminSetup] = useState<AdminSetupStatus>({
    hasEnvPasscode: false,
    hasClaimedPasscode: false,
    hasAdminUser: false,
  });
  const [backendHealth, setBackendHealth] = useState<BackendHealthState>(() => {
    const cfg = getApiBaseConfig();
    return {
      status: cfg.configError ? 'unavailable' : 'checking',
      error: cfg.configError ?? null,
      apiBaseUrl: cfg.baseUrl,
    };
  });
  const [guestLanguage, setGuestLanguage] = useState<SupportedLanguage>('en');
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const authEpochRef = useRef(0);
  const userRef = useRef<PublicUser | null>(null);
  userRef.current = user;

  const clearSessionNotice = useCallback(() => setSessionNotice(null), []);

  const refreshNotifications = useCallback(async () => {
    try {
      const data = await apiRequest<{ notifications: NotificationItem[]; unreadCount: number }>('/api/notifications');
      setNotifications(data.notifications);
      setUnreadCount(data.unreadCount);
    } catch {
      // ignore if unauthenticated
    }
  }, []);

  const refreshSession = useCallback(async () => {
    const epoch = ++authEpochRef.current;
    setLoading(true);
    const cfg = getApiBaseConfig();
    if (cfg.configError) {
      setAuthToken(null);
      userRef.current = null;
      setUser(null);
      setSettings(null);
      setBackendHealth({ status: 'unavailable', error: cfg.configError, apiBaseUrl: cfg.baseUrl });
      setSessionNotice(cfg.configError);
      setLoading(false);
      return;
    }

    const [healthOutcome, sessionOutcome] = await Promise.allSettled([
      checkBackendHealth(),
      apiRequest<{
        authenticated: boolean;
        token?: string;
        user: PublicUser | null;
        settings: UserSettings | null;
        adminSetup: AdminSetupStatus;
        reason?: string;
      }>('/api/auth/session'),
    ]);

    // Ignore stale session-check results if login/logout/another refresh superseded this call
    if (authEpochRef.current !== epoch) {
      return;
    }

    let healthErrorMsg: string | null = null;
    if (healthOutcome.status === 'fulfilled') {
      setBackendHealth({
        status: 'healthy',
        error: null,
        apiBaseUrl: cfg.baseUrl,
        details: healthOutcome.value,
      });
    } else {
      const err = healthOutcome.reason;
      const isDegraded = err instanceof ApiError && err.status === 503;
      healthErrorMsg =
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Backend health check failed.';
      setBackendHealth({
        status: isDegraded ? 'degraded' : 'unavailable',
        error: healthErrorMsg,
        apiBaseUrl: cfg.baseUrl,
      });
    }

    if (sessionOutcome.status === 'fulfilled') {
      const res = sessionOutcome.value;
      setAdminSetup(res.adminSetup);
      if (res.authenticated && res.user && res.settings) {
        if (res.token) {
          setAuthToken(res.token);
        }
        setSessionNotice(healthErrorMsg);
        userRef.current = res.user;
        setUser(res.user);
        setSettings(res.settings);
        setGuestLanguage(res.user.language);
      } else {
        setAuthToken(null);
        userRef.current = null;
        setUser(null);
        setSettings(null);
        if (healthErrorMsg) {
          setSessionNotice(healthErrorMsg);
        } else if (res.reason === 'expired' || res.reason === 'not_found') {
          setSessionNotice('Your previous session expired. Please sign in again.');
        } else if (res.reason === 'inactive') {
          setSessionNotice('This account is deactivated. Please contact an administrator.');
        }
      }
    } else {
      const err = sessionOutcome.reason;
      setAuthToken(null);
      userRef.current = null;
      setUser(null);
      setSettings(null);
      if (healthErrorMsg) {
        setSessionNotice(healthErrorMsg);
      } else if (
        err instanceof ApiError &&
        (err.status === 0 || err.status >= 500 || err.code === 'INVALID_RESPONSE' || err.code === 'INVALID_API_URL')
      ) {
        setSessionNotice(err.message);
      }
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    setOnUnauthorizedHandler((msg) => {
      const wasAuthenticated = Boolean(userRef.current);
      authEpochRef.current += 1;
      setAuthToken(null);
      userRef.current = null;
      setUser(null);
      setSettings(null);
      setNotifications([]);
      setUnreadCount(0);
      if (wasAuthenticated) {
        setSessionNotice(msg || 'Your session expired. Please sign in again.');
      }
    });
    return () => setOnUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (user) {
      void refreshNotifications();
    } else {
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [user, refreshNotifications]);

  // Apply global accessibility & theme classes to <html>
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('text-scale-sm', 'text-scale-normal', 'text-scale-lg', 'text-scale-xl', 'dark');
    const scale = settings?.text_size ?? 'normal';
    html.classList.add(`text-scale-${scale}`);
    if (settings?.theme === 'dark') {
      html.classList.add('dark');
    }
    html.setAttribute('data-contrast', settings?.contrast_mode ?? 'standard');
    html.setAttribute('data-reduced-motion', settings?.reduced_motion ? 'true' : 'false');
  }, [settings]);

  const setAuthData = useCallback((nextUser: PublicUser, nextSettings: UserSettings, token?: string) => {
    authEpochRef.current += 1;
    bumpAuthGeneration();
    setAuthToken(token ?? null);
    userRef.current = nextUser;
    setSessionNotice(null);
    setUser(nextUser);
    setSettings(nextSettings);
    setGuestLanguage(nextUser.language);
    setLoading(false);
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings> & { name?: string; phone?: string; language?: SupportedLanguage }) => {
      const res = await apiRequest<{ user: PublicUser; settings: UserSettings }>('/api/settings', {
        method: 'PUT',
        body: patch,
      });
      userRef.current = res.user;
      setUser(res.user);
      setSettings(res.settings);
      setGuestLanguage(res.user.language);
    },
    []
  );

  const logout = useCallback(async (options?: { skipServer?: boolean }) => {
    authEpochRef.current += 1;
    bumpAuthGeneration();
    userRef.current = null;
    if (!options?.skipServer) {
      try {
        await apiRequest('/api/auth/logout', { method: 'POST' });
      } catch {
        // clear local state even if session already expired
      }
    }
    setAuthToken(null);
    setUser(null);
    setSettings(null);
    setNotifications([]);
    setUnreadCount(0);
    setSessionNotice(null);
  }, []);

  const markNotificationRead = useCallback(async (id: string) => {
    await apiRequest(`/api/notifications/${id}/read`, { method: 'POST' });
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, []);

  const markAllNotificationsRead = useCallback(async () => {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        settings,
        adminSetup,
        backendHealth,
        loading,
        guestLanguage,
        setGuestLanguage,
        notifications,
        unreadCount,
        sessionNotice,
        clearSessionNotice,
        refreshSession,
        refreshNotifications,
        markNotificationRead,
        markAllNotificationsRead,
        setAuthData,
        updateSettings,
        logout,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
