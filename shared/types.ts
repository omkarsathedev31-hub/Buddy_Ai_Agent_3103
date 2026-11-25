export type UserRole = 'senior' | 'caregiver' | 'admin';

export type SupportedLanguage = 'en' | 'hi' | 'mr' | 'hinglish';

export type TextScale = 'sm' | 'normal' | 'lg' | 'xl';

export type ContrastMode = 'standard' | 'high';

export type ThemeMode = 'light' | 'dark';

export type VoiceSpeed = 'slow' | 'normal' | 'fast';

export type SharingLevel = 'minimal' | 'balanced' | 'full';

export type CheckinMood = 'good' | 'okay' | 'not_good';

export type RiskLevel = 'GREEN' | 'YELLOW' | 'RED';

export type AlertType =
  | 'scam_alert'
  | 'safety_alert'
  | 'assistance_request'
  | 'missed_checkin'
  | 'reminder'
  | 'permission_request'
  | 'system_notification';

export type AlertSeverity = 'critical' | 'warning' | 'informational';

export type AlertStatus = 'open' | 'reviewed' | 'resolved';

export type ReminderStatus = 'scheduled' | 'sent' | 'acknowledged' | 'failed';

export type MessagingSetupMode = 'self' | 'caregiver_assisted';

export type MessagingOnboardingStatus =
  | 'not_started'
  | 'instructions_viewed'
  | 'ready_to_send'
  | 'user_confirmed'
  | 'backend_verified';

export interface GranularPermissions {
  checkin_status: boolean;
  checkin_responses: boolean;
  wellness_summaries: boolean;
  safety_alerts: boolean;
  scam_alerts: boolean;
  reminder_status: boolean;
  activity_summaries: boolean;
  ai_summaries: boolean;
  contact_info: boolean;
}

export const PERMISSION_PRESETS: Record<SharingLevel, GranularPermissions> = {
  minimal: {
    checkin_status: true,
    checkin_responses: false,
    wellness_summaries: false,
    safety_alerts: true,
    scam_alerts: false,
    reminder_status: false,
    activity_summaries: false,
    ai_summaries: false,
    contact_info: true,
  },
  balanced: {
    checkin_status: true,
    checkin_responses: true,
    wellness_summaries: true,
    safety_alerts: true,
    scam_alerts: true,
    reminder_status: true,
    activity_summaries: false,
    ai_summaries: false,
    contact_info: true,
  },
  full: {
    checkin_status: true,
    checkin_responses: true,
    wellness_summaries: true,
    safety_alerts: true,
    scam_alerts: true,
    reminder_status: true,
    activity_summaries: true,
    ai_summaries: true,
    contact_info: true,
  },
};

export interface UserSettings {
  user_id: string;
  text_size: TextScale;
  contrast_mode: ContrastMode;
  theme: ThemeMode;
  reduced_motion: boolean;
  voice_enabled: boolean;
  voice_speed: VoiceSpeed;
  voice_name: string | null;
  notifications_enabled: boolean;
  onboarding_completed: boolean;
  updated_at: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: UserRole;
  language: SupportedLanguage;
  is_active: boolean;
  created_at: string;
}

export interface LessonStep {
  stepNumber: number;
  title: string;
  instruction: string;
  tip: string;
}

export interface LessonItem {
  id: string;
  category: 'phone' | 'communication' | 'safety' | 'daily_tools';
  durationMinutes: number;
  title: Record<SupportedLanguage, string>;
  summary: Record<SupportedLanguage, string>;
  steps: Record<SupportedLanguage, LessonStep[]>;
}
