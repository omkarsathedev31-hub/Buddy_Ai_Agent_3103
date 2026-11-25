import React, { useEffect, useMemo, useState } from 'react';
import {
  FileUp,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
} from 'lucide-react';
import type { SupportedLanguage, VoiceSpeed } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { LANGUAGE_LABELS } from '../lib/i18n.ts';
import { isSpeechSynthesisSupported, speedToRate, stopSpeaking } from '../lib/speech.ts';

export function AudioReaderView() {
  const { user, settings } = useApp();
  const [text, setText] = useState(
    'Welcome to the Buddy Elder AI Audio Reader. Paste any WhatsApp message, letter, prescription note, or upload a text document to listen comfortably sentence by sentence.'
  );
  const [readerLang, setReaderLang] = useState<SupportedLanguage>(user?.language ?? 'en');
  const [speed, setSpeed] = useState<VoiceSpeed>(settings?.voice_speed ?? 'normal');
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ttsSupported = isSpeechSynthesisSupported();

  const sentences = useMemo(() => {
    const parts = text
      .split(/(?<=[.!?।])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  }, [text]);

  useEffect(() => {
    return () => stopSpeaking();
  }, []);

  function speakSentenceAt(index: number) {
    if (!ttsSupported) {
      setError('Speech synthesis is not supported in this browser.');
      return;
    }
    if (index < 0 || index >= sentences.length) {
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentIdx(0);
      return;
    }

    window.speechSynthesis.cancel();
    setCurrentIdx(index);
    setIsPlaying(true);
    setIsPaused(false);

    const utterance = new SpeechSynthesisUtterance(sentences[index]);
    utterance.lang = LANGUAGE_LABELS[readerLang]?.bcp47 ?? 'en-IN';
    utterance.rate = speedToRate(speed);
    utterance.onend = () => {
      if (index + 1 < sentences.length) {
        speakSentenceAt(index + 1);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
    };
    utterance.onerror = () => {
      setIsPlaying(false);
      setIsPaused(false);
    };
    window.speechSynthesis.speak(utterance);
  }

  function handlePlayOrResume() {
    setError(null);
    if (isPaused && ttsSupported) {
      window.speechSynthesis.resume();
      setIsPaused(false);
      setIsPlaying(true);
      return;
    }
    speakSentenceAt(currentIdx < sentences.length ? currentIdx : 0);
  }

  function handlePause() {
    if (ttsSupported && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      setIsPaused(true);
      setIsPlaying(false);
    }
  }

  function handleStop() {
    stopSpeaking();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentIdx(0);
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    handleStop();

    const ext = file.name.toLowerCase().split('.').pop() || '';
    if (!['txt', 'md', 'csv', 'json', 'log'].includes(ext)) {
      setError(
        `Unsupported file format (.${ext}). Please upload plain text files (.txt, .md, .csv) or paste the text directly.`
      );
      return;
    }

    try {
      const raw = await file.text();
      const res = await apiRequest<{ text: string }>('/api/reader/parse-upload', {
        method: 'POST',
        body: { filename: file.name, content: raw },
      });
      setText(res.text);
      setCurrentIdx(0);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to read uploaded document.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">Read This — Audio Reader</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Paste any message or upload a text document to hear it read clearly with highlighted sentences.
          </p>
        </div>

        <label className="min-h-[48px] px-5 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 self-start">
          <FileUp className="w-5 h-5" />
          <span>Upload .txt / .md File</span>
          <input type="file" accept=".txt,.md,.csv,.json,.log" onChange={handleFileUpload} className="sr-only" />
        </label>
      </div>

      {error && (
        <div role="alert" className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-300 text-red-900 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="reader-textarea" className="font-semibold">
              Text to Read Aloud
            </label>
            <div className="flex items-center gap-2">
              <select
                aria-label="Reading Language"
                value={readerLang}
                onChange={(e) => setReaderLang(e.target.value as SupportedLanguage)}
                className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                {(['en', 'hi', 'mr', 'hinglish'] as SupportedLanguage[]).map((l) => (
                  <option key={l} value={l}>
                    {LANGUAGE_LABELS[l].native}
                  </option>
                ))}
              </select>
              <select
                aria-label="Reading Speed"
                value={speed}
                onChange={(e) => setSpeed(e.target.value as VoiceSpeed)}
                className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950"
              >
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
              </select>
            </div>
          </div>

          <textarea
            id="reader-textarea"
            rows={8}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCurrentIdx(0);
            }}
            className="w-full p-4 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base leading-relaxed"
          />

          <div className="flex flex-wrap gap-2.5">
            {!isPlaying ? (
              <button
                type="button"
                disabled={!ttsSupported || sentences.length === 0}
                onClick={handlePlayOrResume}
                className="min-h-[52px] px-6 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-50 text-white font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Play className="w-5 h-5" />
                <span>{isPaused ? 'Resume' : 'Read Aloud'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handlePause}
                className="min-h-[52px] px-6 rounded-2xl bg-[#C2592B] text-white font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Pause className="w-5 h-5" />
                <span>Pause</span>
              </button>
            )}

            <button
              type="button"
              disabled={sentences.length === 0}
              onClick={() => speakSentenceAt(Math.max(0, currentIdx - 1))}
              className="min-h-[52px] px-4 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <SkipBack className="w-5 h-5" />
              <span>Back</span>
            </button>

            <button
              type="button"
              disabled={sentences.length === 0}
              onClick={() => speakSentenceAt(Math.min(sentences.length - 1, currentIdx + 1))}
              className="min-h-[52px] px-4 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <span>Next</span>
              <SkipForward className="w-5 h-5" />
            </button>

            <button
              type="button"
              disabled={sentences.length === 0}
              onClick={() => speakSentenceAt(currentIdx)}
              className="min-h-[52px] px-4 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-5 h-5" />
              <span>Repeat</span>
            </button>

            <button
              type="button"
              onClick={handleStop}
              className="min-h-[52px] px-4 rounded-2xl border border-slate-300 dark:border-slate-700 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Square className="w-5 h-5" />
              <span>Stop</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 hc-surface space-y-4">
          <div className="flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-[#0F5156] dark:text-teal-400" />
            <h2 className="font-display text-xl font-bold">Follow Along (Tap any sentence to hear it)</h2>
          </div>
          {sentences.length === 0 ? (
            <p className="text-slate-500">Enter or upload text to see readable sentences here.</p>
          ) : (
            <div className="space-y-2.5 max-h-[400px] overflow-y-auto">
              {sentences.map((s, idx) => (
                <button
                  key={`${idx}-${s.slice(0, 12)}`}
                  type="button"
                  onClick={() => speakSentenceAt(idx)}
                  className={`w-full text-left p-4 rounded-2xl border transition-colors cursor-pointer ${
                    idx === currentIdx && (isPlaying || isPaused)
                      ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/50 font-semibold'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
