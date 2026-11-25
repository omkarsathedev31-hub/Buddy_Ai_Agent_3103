import { useEffect, useState } from 'react';
import { BookOpen, CheckCircle2, Circle, Volume2 } from 'lucide-react';
import type { LessonItem, SupportedLanguage } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { apiRequest } from '../lib/api.ts';
import { speakText, stopSpeaking } from '../lib/speech.ts';

interface LessonWithProgress extends LessonItem {
  progress: {
    completedSteps: number[];
    isCompleted: boolean;
    lastStep: number;
    updatedAt: string | null;
  };
}

export function LearnTechView() {
  const { user, settings } = useApp();
  const lang: SupportedLanguage = user?.language ?? 'en';
  const [lessons, setLessons] = useState<LessonWithProgress[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadLessons();
    return () => stopSpeaking();
  }, []);

  async function loadLessons() {
    setLoading(true);
    try {
      const res = await apiRequest<{
        lessons: LessonWithProgress[];
        completedCount: number;
        totalCount: number;
      }>('/api/lessons');
      setLessons(res.lessons);
      setCompletedCount(res.completedCount);
      if (!activeLessonId && res.lessons.length > 0) {
        const inProgress = res.lessons.find((l) => !l.progress.isCompleted && l.progress.completedSteps.length > 0);
        setActiveLessonId(inProgress?.id ?? res.lessons[0].id);
      }
    } finally {
      setLoading(false);
    }
  }

  const activeLesson = lessons.find((l) => l.id === activeLessonId) || null;
  const activeSteps = activeLesson ? activeLesson.steps[lang] ?? activeLesson.steps.en : [];

  async function toggleStep(stepNumber: number) {
    if (!activeLesson) return;
    setSaving(true);
    const existing = activeLesson.progress.completedSteps;
    const nextSteps = existing.includes(stepNumber)
      ? existing.filter((s) => s !== stepNumber)
      : [...existing, stepNumber].sort((a, b) => a - b);
    const isCompleted = nextSteps.length >= activeSteps.length;

    try {
      const updated = await apiRequest<{
        lessonId: string;
        completedSteps: number[];
        isCompleted: boolean;
        lastStep: number;
        updatedAt: string;
      }>(`/api/lessons/${activeLesson.id}/progress`, {
        method: 'PUT',
        body: {
          completedSteps: nextSteps,
          lastStep: stepNumber,
          isCompleted,
        },
      });

      setLessons((prev) => {
        const mapped = prev.map((l) =>
          l.id === activeLesson.id ? { ...l, progress: updated } : l
        );
        setCompletedCount(mapped.filter((l) => l.progress.isCompleted).length);
        return mapped;
      });
    } finally {
      setSaving(false);
    }
  }

  async function markLessonComplete() {
    if (!activeLesson) return;
    setSaving(true);
    const allSteps = activeSteps.map((s) => s.stepNumber);
    try {
      const updated = await apiRequest<{
        lessonId: string;
        completedSteps: number[];
        isCompleted: boolean;
        lastStep: number;
        updatedAt: string;
      }>(`/api/lessons/${activeLesson.id}/progress`, {
        method: 'PUT',
        body: {
          completedSteps: allSteps,
          lastStep: allSteps.length,
          isCompleted: true,
        },
      });
      setLessons((prev) => {
        const mapped = prev.map((l) =>
          l.id === activeLesson.id ? { ...l, progress: updated } : l
        );
        setCompletedCount(mapped.filter((l) => l.progress.isCompleted).length);
        return mapped;
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="p-6 text-lg">Loading technology lessons...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Learn Technology</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Simple, beginner-friendly lessons saved automatically to your profile.
          </p>
        </div>
        <div className="px-5 py-3 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 font-semibold font-mono-nums">
          {completedCount} of {lessons.length} Lessons Completed
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <aside className="lg:col-span-5 space-y-3">
          {lessons.map((lesson) => (
            <button
              key={lesson.id}
              type="button"
              onClick={() => setActiveLessonId(lesson.id)}
              className={`w-full text-left p-5 rounded-3xl border transition-colors cursor-pointer space-y-2 ${
                activeLessonId === lesson.id
                  ? 'border-[#0F5156] bg-teal-50/70 dark:bg-teal-950/40'
                  : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-display text-lg font-bold">{lesson.title[lang] ?? lesson.title.en}</h2>
                {lesson.progress.isCompleted ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                ) : (
                  <BookOpen className="w-5 h-5 text-slate-400 shrink-0" />
                )}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                {lesson.summary[lang] ?? lesson.summary.en}
              </p>
              <p className="text-xs font-semibold text-slate-500 font-mono-nums">
                {lesson.progress.completedSteps.length} / {lesson.steps.en.length} steps · {lesson.durationMinutes} min
              </p>
            </button>
          ))}
        </aside>

        <section className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 hc-surface space-y-5">
          {activeLesson ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                <div>
                  <h2 className="font-display text-2xl font-bold">
                    {activeLesson.title[lang] ?? activeLesson.title.en}
                  </h2>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                    {activeLesson.summary[lang] ?? activeLesson.summary.en}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    speakText(
                      `${activeLesson.title[lang]}. ${activeSteps
                        .map((s) => `Step ${s.stepNumber}: ${s.title}. ${s.instruction}`)
                        .join(' ')}`,
                      { language: lang, speed: settings?.voice_speed ?? 'normal' }
                    )
                  }
                  className="min-h-[48px] px-4 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-2 shrink-0 cursor-pointer"
                >
                  <Volume2 className="w-5 h-5" />
                  <span>Read Lesson Aloud</span>
                </button>
              </div>

              <div className="space-y-4">
                {activeSteps.map((step) => {
                  const done = activeLesson.progress.completedSteps.includes(step.stepNumber);
                  return (
                    <div
                      key={step.stepNumber}
                      className={`p-5 rounded-2xl border space-y-2 ${
                        done
                          ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30'
                          : 'border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-display text-lg font-bold">
                          Step {step.stepNumber}: {step.title}
                        </h3>
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void toggleStep(step.stepNumber)}
                          className={`min-h-[44px] px-3.5 rounded-xl font-semibold text-sm flex items-center gap-1.5 shrink-0 cursor-pointer ${
                            done
                              ? 'bg-emerald-700 text-white'
                              : 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                          }`}
                        >
                          {done ? <CheckCircle2 className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                          <span>{done ? 'Done' : 'Mark Done'}</span>
                        </button>
                      </div>
                      <p className="text-base leading-relaxed">{step.instruction}</p>
                      <p className="text-sm text-[#0F5156] dark:text-teal-400 font-medium">
                        Helpful Tip: {step.tip}
                      </p>
                    </div>
                  );
                })}
              </div>

              {!activeLesson.progress.isCompleted && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void markLessonComplete()}
                  className="w-full min-h-[52px] rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold text-lg cursor-pointer"
                >
                  {saving ? 'Saving Progress...' : 'Complete This Lesson'}
                </button>
              )}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
