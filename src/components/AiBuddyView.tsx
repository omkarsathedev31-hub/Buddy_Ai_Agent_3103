import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  MessageSquarePlus,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  Square,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { SupportedLanguage } from '../../shared/types.ts';
import { useApp } from '../contexts/AppContext.tsx';
import { ApiError, apiRequest } from '../lib/api.ts';
import { LANGUAGE_LABELS, t } from '../lib/i18n.ts';
import {
  isSpeechRecognitionSupported,
  speakText,
  startVoiceInput,
  stopSpeaking,
} from '../lib/speech.ts';

interface Conversation {
  id: string;
  title: string;
  language: SupportedLanguage;
  last_status?: 'idle' | 'pending' | 'responded' | 'failed';
  last_error_code?: string | null;
  last_error_message?: string | null;
  updated_at: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  language: SupportedLanguage;
  created_at: string;
}

const STARTER_PROMPTS: Record<SupportedLanguage, string[]> = {
  en: ['How do I send a photo on WhatsApp?', 'How do I increase my phone volume?', 'How do I spot a fake bank call?'],
  hi: ['व्हाट्सएप पर फोटो कैसे भेजें?', 'फ़ोन की आवाज़ कैसे बढ़ाएँ?', 'नकली बैंक कॉल कैसे पहचानें?'],
  mr: ['व्हॉट्सअॅपवर फोटो कसा पाठवावा?', 'फोनचा आवाज कसा वाढवावा?', 'बनावट बँक कॉल कसा ओळखावा?'],
  hinglish: ['WhatsApp par photo kaise bhejein?', 'Phone ka volume kaise badhayein?', 'Fake bank call kaise pehchanein?'],
};

export function AiBuddyView() {
  const { user, settings } = useApp();
  const [chatLang, setChatLang] = useState<SupportedLanguage>(user?.language ?? 'en');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [lastFailedInput, setLastFailedInput] = useState<string | null>(null);

  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [aiKeyWarning, setAiKeyWarning] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCooldownSec, setRetryCooldownSec] = useState(0);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  const stopMicRef = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const sendingRef = useRef(false);
  const initStartedRef = useRef(false);

  useEffect(() => {
    if (!initStartedRef.current) {
      initStartedRef.current = true;
      void loadInitial();
    }
    return () => {
      stopSpeaking();
      stopMicRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (retryCooldownSec <= 0) return;
    const timer = setTimeout(() => {
      setRetryCooldownSec((s) => (s > 1 ? s - 1 : 0));
    }, 1000);
    return () => clearTimeout(timer);
  }, [retryCooldownSec]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  function persistActiveConvId(convId: string | null) {
    if (typeof window === 'undefined' || !user?.id) return;
    try {
      const storageKey = `buddy_active_conv_${user.id}`;
      if (convId) window.sessionStorage.setItem(storageKey, convId);
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      // ignore storage errors
    }
  }

  function readSavedConvId(): string | null {
    if (typeof window === 'undefined' || !user?.id) return null;
    try {
      return window.sessionStorage.getItem(`buddy_active_conv_${user.id}`);
    } catch {
      return null;
    }
  }

  async function loadInitial() {
    setLoadingList(true);
    try {
      const [statusRes, convRes] = await Promise.all([
        apiRequest<{ configured: boolean; model: string; fallbackModel?: string | null; keyWarning?: string }>(
          '/api/ai/status'
        ),
        apiRequest<{ conversations: Conversation[] }>('/api/ai/conversations'),
      ]);
      const validConvs = Array.isArray(convRes?.conversations)
        ? convRes.conversations.filter((c): c is Conversation => Boolean(c && typeof c.id === 'string'))
        : [];
      setAiConfigured(typeof statusRes?.configured === 'boolean' ? statusRes.configured : null);
      setAiKeyWarning(typeof statusRes?.keyWarning === 'string' ? statusRes.keyWarning : null);
      setConversations(validConvs);
      if (validConvs.length > 0) {
        const savedId = readSavedConvId();
        const target = savedId && validConvs.some((c) => c.id === savedId) ? savedId : validConvs[0].id;
        await selectConversation(target);
      } else {
        await createConversation();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load AI Buddy.');
    } finally {
      setLoadingList(false);
    }
  }

  async function createConversation() {
    setError(null);
    setLastFailedInput(null);
    setRetryCooldownSec(0);
    setQuotaExhausted(false);
    setSuggestions([]);
    try {
      const res = await apiRequest<{ conversation?: Conversation }>('/api/ai/conversations', {
        method: 'POST',
        body: { language: chatLang },
      });
      if (!res?.conversation?.id) {
        throw new Error('Could not start a new conversation. Please try again.');
      }
      const created = res.conversation;
      setConversations((prev) => [created, ...prev.filter((c): c is Conversation => Boolean(c?.id))]);
      setActiveConvId(created.id);
      persistActiveConvId(created.id);
      setMessages([]);
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Unable to start a new conversation.');
    }
  }

  async function selectConversation(id: string) {
    setError(null);
    setLastFailedInput(null);
    setRetryCooldownSec(0);
    setQuotaExhausted(false);
    setActiveConvId(id);
    persistActiveConvId(id);
    try {
      const res = await apiRequest<{ conversation?: Conversation; messages?: ChatMessage[] }>(
        `/api/ai/conversations/${id}/messages`
      );
      const validMsgs = Array.isArray(res?.messages)
        ? res.messages.filter((m): m is ChatMessage => Boolean(m && typeof m.id === 'string'))
        : [];
      setMessages(validMsgs);
      const trailingMsg = validMsgs[validMsgs.length - 1];
      if (trailingMsg && trailingMsg.role === 'user' && trailingMsg.content.trim()) {
        setLastFailedInput(trailingMsg.content);
        if (res?.conversation?.last_status === 'failed' && res.conversation.last_error_message) {
          setError(res.conversation.last_error_message);
          setQuotaExhausted(res.conversation.last_error_code === 'AI_QUOTA_EXHAUSTED');
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to load conversation messages.');
    }
  }

  async function deleteConversation(id: string) {
    setError(null);
    try {
      await apiRequest(`/api/ai/conversations/${id}`, { method: 'DELETE' });
      const remaining = conversations.filter((c) => c && c.id !== id);
      setConversations(remaining);
      if (activeConvId === id) {
        if (remaining.length > 0) {
          await selectConversation(remaining[0].id);
        } else {
          await createConversation();
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to delete conversation.');
    }
  }

  async function clearActiveConversation() {
    if (!activeConvId) return;
    setError(null);
    setLastFailedInput(null);
    setRetryCooldownSec(0);
    setQuotaExhausted(false);
    try {
      await apiRequest(`/api/ai/conversations/${activeConvId}/clear`, { method: 'POST' });
      setMessages([]);
      setSuggestions([]);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? { ...c, last_status: 'idle', last_error_code: null, last_error_message: null }
            : c
        )
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to clear conversation.');
    }
  }

  async function sendMessage(textOverride?: string) {
    const content = (textOverride ?? input).trim();
    if (!content || sendingRef.current || loadingList || retryCooldownSec > 0) return;

    sendingRef.current = true;
    const hadTypedInput = !textOverride || textOverride === input.trim();
    setError(null);
    setQuotaExhausted(false);
    setLastFailedInput(null);
    setSending(true);
    if (!textOverride) setInput('');

    let targetConvId: string | null = activeConvId;

    try {
      let convId = activeConvId;
      if (!convId) {
        const created = await apiRequest<{ conversation?: Conversation }>('/api/ai/conversations', {
          method: 'POST',
          body: { language: chatLang },
        });
        if (!created?.conversation?.id) {
          throw new Error('Could not create a conversation before sending.');
        }
        const newConv = created.conversation;
        convId = newConv.id;
        targetConvId = convId;
        setConversations((prev) => [newConv, ...prev.filter((c): c is Conversation => Boolean(c?.id))]);
        setActiveConvId(convId);
        persistActiveConvId(convId);
      }

      const res = await apiRequest<{
        success?: boolean;
        reply?: string;
        response?: string;
        conversationId?: string;
        userMessage?: ChatMessage;
        assistantMessage?: ChatMessage;
        suggestions?: string[];
        title?: string;
      }>(`/api/ai/conversations/${convId}/messages`, {
        method: 'POST',
        body: { message: content, language: chatLang },
        timeoutMs: 40_000,
      });

      const replyText = typeof res?.reply === 'string' && res.reply.trim() ? res.reply : res?.response;
      const nowIso = new Date().toISOString();
      const userMsg: ChatMessage | undefined = res?.userMessage?.id
        ? res.userMessage
        : typeof replyText === 'string' && replyText.trim()
        ? {
            id: `local-u-${Date.now()}`,
            role: 'user',
            content,
            language: chatLang,
            created_at: nowIso,
          }
        : undefined;
      const botMsg: ChatMessage | undefined = res?.assistantMessage?.id
        ? res.assistantMessage
        : typeof replyText === 'string' && replyText.trim()
        ? {
            id: `local-a-${Date.now()}`,
            role: 'assistant',
            content: replyText.trim(),
            language: chatLang,
            created_at: nowIso,
          }
        : undefined;

      if (!userMsg?.id || !botMsg?.id || !botMsg.content?.trim()) {
        throw new Error('Received an incomplete reply from Buddy Elder AI. Please try again.');
      }

      const resolvedConvId = res.conversationId || convId;
      const updatedAt = botMsg.created_at ?? nowIso;
      const nextTitle = typeof res.title === 'string' && res.title.trim() ? res.title : undefined;

      setMessages((prev) => {
        const existing = prev.filter((m): m is ChatMessage => Boolean(m?.id));
        const seen = new Set(existing.map((m) => m.id));
        const next = [...existing];
        if (!seen.has(userMsg.id)) {
          seen.add(userMsg.id);
          next.push(userMsg);
        }
        if (!seen.has(botMsg.id)) {
          next.push(botMsg);
        }
        return next;
      });
      setSuggestions(Array.isArray(res.suggestions) ? res.suggestions : []);
      setConversations((prev) =>
        prev
          .filter((c): c is Conversation => Boolean(c?.id))
          .map((c) =>
            c.id === resolvedConvId
              ? {
                  ...c,
                  title: nextTitle ?? c.title,
                  last_status: 'responded',
                  last_error_code: null,
                  last_error_message: null,
                  updated_at: updatedAt,
                }
              : c
          )
      );
      if (hadTypedInput) {
        setInput('');
      }

      if (settings?.voice_enabled) {
        handleSpeakMessage(botMsg.id, botMsg.content, chatLang);
      }
    } catch (err) {
      setLastFailedInput(content);
      const savedMsg =
        err instanceof ApiError && err.userMessageSaved && err.userMessage?.id
          ? (err.userMessage as ChatMessage)
          : undefined;

      if (savedMsg) {
        setMessages((prev) => {
          const existing = prev.filter((m): m is ChatMessage => Boolean(m?.id));
          if (existing.some((m) => m.id === savedMsg.id)) return existing;
          return [...existing, savedMsg];
        });
        if (targetConvId) {
          const titleCandidate = content.slice(0, 48) + (content.length > 48 ? '…' : '');
          const errCode = err instanceof ApiError ? err.code : 'AI_SERVICE_ERROR';
          const errMsg = err instanceof ApiError || err instanceof Error ? err.message : null;
          setConversations((prev) =>
            prev
              .filter((c): c is Conversation => Boolean(c?.id))
              .map((c) =>
                c.id === targetConvId
                  ? {
                      ...c,
                      title: c.title === 'New Conversation' ? titleCandidate : c.title,
                      last_status: 'failed',
                      last_error_code: errCode,
                      last_error_message: errMsg,
                      updated_at: savedMsg.created_at || c.updated_at,
                    }
                  : c
              )
          );
        }
        if (hadTypedInput) setInput('');
      } else if (!textOverride) {
        setInput(content);
      }

      if (err instanceof ApiError && err.status === 429) {
        const isQuota = Boolean(err.quotaExhausted || err.code === 'AI_QUOTA_EXHAUSTED');
        setQuotaExhausted(isQuota);
        const rawWait = err.retryAfterSeconds ?? 15;
        setRetryCooldownSec(Math.min(Math.max(1, rawWait), isQuota ? 20 : 30));
      } else {
        setQuotaExhausted(false);
        setRetryCooldownSec(0);
      }

      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Unable to reach AI Buddy right now.'
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  }

  function handleSpeakMessage(msgId: string, text: string, lang: SupportedLanguage) {
    if (speakingMsgId === msgId) {
      stopSpeaking();
      setSpeakingMsgId(null);
      return;
    }
    setSpeakingMsgId(msgId);
    speakText(text, {
      language: lang,
      speed: settings?.voice_speed ?? 'normal',
      voiceName: settings?.voice_name,
      onEnd: () => setSpeakingMsgId(null),
      onError: (msg) => {
        setSpeakingMsgId(null);
        setError(msg);
      },
    });
  }

  function toggleVoiceMic() {
    if (listening) {
      stopMicRef.current?.();
      setListening(false);
      return;
    }
    setError(null);
    setListening(true);
    stopMicRef.current = startVoiceInput({
      language: chatLang,
      onResult: (transcript) => {
        setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      },
      onError: (msg) => {
        setError(msg);
        setListening(false);
      },
      onEnd: () => setListening(false),
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">{t(chatLang, 'aiBuddy')}</h1>
          <p className="text-slate-600 dark:text-slate-400">
            Ask step-by-step questions about your phone, WhatsApp, maps, or staying safe online.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor="ai-lang-select" className="text-sm font-semibold">
            Reply Language:
          </label>
          <select
            id="ai-lang-select"
            value={chatLang}
            onChange={(e) => setChatLang(e.target.value as SupportedLanguage)}
            className="min-h-[44px] px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium"
          >
            {(['en', 'hi', 'mr', 'hinglish'] as SupportedLanguage[]).map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l].native}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(aiConfigured === false || aiKeyWarning) && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-200 flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              {aiConfigured === false ? 'AI Provider Not Configured' : 'AI Configuration Notice'}
            </p>
            <p className="text-sm">
              {aiConfigured === false
                ? 'The server could not find GEMINI_API_KEY. Add it to the .env file in the project folder (or your host\'s environment variables), then restart the server. Real AI replies start working as soon as it is found.'
                : aiKeyWarning}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Conversation History Sidebar */}
        <aside className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 hc-surface space-y-3">
          <button
            type="button"
            onClick={() => void createConversation()}
            className="w-full min-h-[48px] px-4 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] text-white font-semibold flex items-center justify-center gap-2 cursor-pointer"
          >
            <MessageSquarePlus className="w-5 h-5" />
            <span>New Conversation</span>
          </button>

          <div className="space-y-1.5 max-h-[340px] overflow-y-auto">
            {loadingList ? (
              <p className="text-sm text-slate-500 p-2">Loading history...</p>
            ) : conversations.length === 0 ? (
              <p className="text-sm text-slate-500 p-2">No past chats yet.</p>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 border ${
                    activeConvId === conv.id
                      ? 'border-[#0F5156] bg-teal-50 dark:bg-teal-950/40'
                      : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void selectConversation(conv.id)}
                    className="flex-1 text-left min-h-[40px] truncate font-medium cursor-pointer"
                  >
                    {conv.title}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete conversation ${conv.title}`}
                    onClick={() => void deleteConversation(conv.id)}
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Active Chat Panel */}
        <section className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 hc-surface flex flex-col min-h-[520px]">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-200 dark:border-slate-800">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Private to you · Never ask or share OTPs or bank PINs
            </p>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => void clearActiveConversation()}
                className="text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-red-600 min-h-[40px] px-2 cursor-pointer"
              >
                Clear Chat
              </button>
            )}
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto pr-1 max-h-[420px]">
            {messages.length === 0 ? (
              <div className="py-6 space-y-4">
                <p className="font-semibold text-lg">Try asking Buddy Elder AI:</p>
                <div className="grid grid-cols-1 gap-2.5">
                  {STARTER_PROMPTS[chatLang].map((q) => (
                    <button
                      key={q}
                      type="button"
                      disabled={sending || loadingList || retryCooldownSec > 0}
                      onClick={() => void sendMessage(q)}
                      className="min-h-[48px] px-4 py-3 text-left rounded-2xl border border-slate-200 dark:border-slate-700 hover:border-[#0F5156] hover:bg-teal-50/50 dark:hover:bg-teal-950/30 disabled:opacity-50 font-medium cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-2xl p-4 space-y-2 ${
                      msg.role === 'user'
                        ? 'bg-[#0F5156] text-white'
                        : 'bg-[#F3F0EA] dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    {msg.role === 'assistant' && (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleSpeakMessage(msg.id, msg.content, msg.language)}
                          className="min-h-[40px] px-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-sm font-semibold flex items-center gap-1.5 cursor-pointer"
                        >
                          {speakingMsgId === msg.id ? (
                            <>
                              <Square className="w-4 h-4" />
                              <span>{t(chatLang, 'stopSpeaking')}</span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="w-4 h-4" />
                              <span>{t(chatLang, 'speak')}</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {sending && (
              <div className="p-4 rounded-2xl bg-[#F3F0EA] dark:bg-slate-800 max-w-[70%] text-slate-700 dark:text-slate-300">
                Buddy Elder AI is thinking carefully...
              </div>
            )}
            <div ref={endRef} />
          </div>

          {suggestions.length > 0 && !sending && (
            <div className="flex flex-wrap gap-2 pt-3">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={sending || loadingList || retryCooldownSec > 0}
                  onClick={() => void sendMessage(s)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 cursor-pointer text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className={`mt-3 p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                retryCooldownSec > 0 || quotaExhausted
                  ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100'
                  : 'bg-red-50 dark:bg-red-950/50 border-red-300 dark:border-red-800 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">{error}</p>
                {retryCooldownSec > 0 && (
                  <p className="text-xs opacity-90">
                    Retry will be enabled in {retryCooldownSec} seconds.
                  </p>
                )}
              </div>
              {lastFailedInput && (
                <button
                  type="button"
                  disabled={sending || retryCooldownSec > 0}
                  onClick={() => void sendMessage(lastFailedInput)}
                  className={`min-h-[44px] px-4 rounded-xl disabled:opacity-60 text-white text-sm font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer ${
                    retryCooldownSec > 0 || quotaExhausted ? 'bg-amber-700 hover:bg-amber-800' : 'bg-red-700 hover:bg-red-800'
                  }`}
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>{retryCooldownSec > 0 ? `Retry in ${retryCooldownSec}s` : t(chatLang, 'retry')}</span>
                </button>
              )}
            </div>
          )}

          {!error && !sending && lastFailedInput && messages[messages.length - 1]?.role === 'user' && (
            <div className="mt-3 p-3 rounded-2xl border border-teal-200 dark:border-teal-800 bg-teal-50/70 dark:bg-teal-950/30 flex items-center justify-between gap-3">
              <p className="text-sm text-slate-700 dark:text-slate-300">
                Your last question is saved above and waiting for Buddy&apos;s reply.
              </p>
              <button
                type="button"
                disabled={sending || retryCooldownSec > 0}
                onClick={() => void sendMessage(lastFailedInput)}
                className="min-h-[40px] px-4 rounded-xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-4 h-4" />
                <span>{t(chatLang, 'retry')}</span>
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-2.5"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your question here..."
              aria-label="Ask Buddy Elder AI"
              className="flex-1 min-h-[52px] px-4 rounded-2xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base"
            />
            <div className="flex gap-2">
              {isSpeechRecognitionSupported() && (
                <button
                  type="button"
                  onClick={toggleVoiceMic}
                  className={`min-h-[52px] px-4 rounded-2xl font-semibold flex items-center gap-2 cursor-pointer ${
                    listening
                      ? 'bg-[#C2592B] text-white'
                      : 'border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                  <span>{listening ? t(chatLang, 'listening') : t(chatLang, 'listenVoice')}</span>
                </button>
              )}
              <button
                type="submit"
                disabled={sending || loadingList || retryCooldownSec > 0 || !input.trim()}
                className="min-h-[52px] px-6 rounded-2xl bg-[#0F5156] hover:bg-[#0c4246] disabled:opacity-50 text-white font-semibold flex items-center gap-2 cursor-pointer"
              >
                <Send className="w-5 h-5" />
                <span>Send</span>
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
