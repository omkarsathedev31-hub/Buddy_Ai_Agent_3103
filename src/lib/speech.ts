import type { SupportedLanguage, VoiceSpeed } from '../../shared/types.ts';
import { LANGUAGE_LABELS } from './i18n.ts';

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

export function speedToRate(speed: VoiceSpeed): number {
  if (speed === 'slow') return 0.8;
  if (speed === 'fast') return 1.2;
  return 1.0;
}

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) return [];
  return window.speechSynthesis.getVoices();
}

export function stopSpeaking(): void {
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
}

export function pauseSpeaking(): void {
  if (isSpeechSynthesisSupported() && window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
  }
}

export function resumeSpeaking(): void {
  if (isSpeechSynthesisSupported() && window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
  }
}

export function speakText(
  text: string,
  options: {
    language: SupportedLanguage;
    speed: VoiceSpeed;
    voiceName?: string | null;
    onEnd?: () => void;
    onError?: (msg: string) => void;
  }
): boolean {
  if (!isSpeechSynthesisSupported()) {
    options.onError?.('Text-to-speech is not supported in this browser.');
    return false;
  }
  const clean = text.trim();
  if (!clean) return false;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  const bcp47 = LANGUAGE_LABELS[options.language]?.bcp47 ?? 'en-IN';
  utterance.lang = bcp47;
  utterance.rate = speedToRate(options.speed);

  const voices = window.speechSynthesis.getVoices();
  if (options.voiceName) {
    const matched = voices.find((v) => v.name === options.voiceName);
    if (matched) utterance.voice = matched;
  } else {
    const langPrefix = bcp47.split('-')[0];
    const matched =
      voices.find((v) => v.lang.toLowerCase() === bcp47.toLowerCase()) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(langPrefix));
    if (matched) utterance.voice = matched;
  }

  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onError?.('Unable to play voice output right now.');

  window.speechSynthesis.speak(utterance);
  return true;
}

export function startVoiceInput(options: {
  language: SupportedLanguage;
  onResult: (transcript: string) => void;
  onError: (msg: string) => void;
  onEnd?: () => void;
}): (() => void) | null {
  if (!isSpeechRecognitionSupported()) {
    options.onError('Voice input is not supported in this browser. Please type your question.');
    return null;
  }

  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
  };
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = LANGUAGE_LABELS[options.language]?.bcp47 ?? 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    const transcript = event.results?.[0]?.[0]?.transcript;
    if (transcript) {
      options.onResult(transcript);
    }
  };
  recognition.onerror = (event) => {
    const errCode = event.error || 'unknown';
    if (errCode === 'not-allowed') {
      options.onError('Microphone permission was denied. Please allow microphone access in your browser.');
    } else if (errCode === 'no-speech') {
      options.onError('No speech was heard. Please speak clearly and try again.');
    } else {
      options.onError(`Voice input error (${errCode}). Please try again or type your message.`);
    }
  };
  recognition.onend = () => options.onEnd?.();

  try {
    recognition.start();
    return () => {
      try {
        recognition.stop();
      } catch {
        // ignore stop errors
      }
    };
  } catch {
    options.onError('Could not start microphone listening.');
    return null;
  }
}

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}
