'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */
type SpeechRecognition = any;
type SpeechRecognitionEvent = any;

/**
 * Cletus AI page — text chat + Cletus Live (voice) + 8 token signals
 * Black background, logo on every page. Signals quote: USDC.
 * Route: /app/ai
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type TokenSignal = {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  score: number;
  change24h: number;
  note: string;
};


export default function CletusAIPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content:
        "Hey — I'm Cletus. Ask me about Solana tokens, signals, risk, or your setup. I'm software, not a human advisor. Trading can lose money.",
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [signals, setSignals] = useState<TokenSignal[]>([]);
  const convRef = useRef<string | null>(null);
  const requestInFlightRef = useRef(false);
  const selectionVersionRef = useRef(0);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Array<{ id: string; title: string }>>([]);
  const [historyReady, setHistoryReady] = useState(false);

  const selectConversation = useCallback(async (id: string) => {
    if (requestInFlightRef.current) return;
    const version = ++selectionVersionRef.current;
    const response = await fetch(`/api/brain?conversationId=${encodeURIComponent(id)}`, { cache: 'no-store' });
    if (!response.ok || version !== selectionVersionRef.current) return;
    const data = await response.json();
    if (version !== selectionVersionRef.current) return;
    convRef.current = id;
    setConversationId(id);
    setMessages((data.messages ?? []).map((m: { role: string; content: string }) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, content: m.content })));
  }, []);

  const refreshConversations = useCallback(async () => {
    const response = await fetch('/api/brain', { cache: 'no-store' });
    if (!response.ok) return [];
    const data = await response.json();
    const list = (data.conversations ?? []) as Array<{ id: string; title: string }>;
    setConversations(list);
    return list;
  }, []);

  useEffect(() => {
    let active = true;
    refreshConversations().then(async (list) => {
      if (!active) return;
      // Server-side ownership checks apply when opening a conversation.
      if (list.length) await selectConversation(list[0].id);
    }).catch(() => {}).finally(() => { if (active) setHistoryReady(true); });
    return () => { active = false; };
  }, [refreshConversations, selectConversation]);

  const newConversation = () => {
    if (requestInFlightRef.current) return;
    ++selectionVersionRef.current;
    convRef.current = null;
    setConversationId(null);
    setMessages([]);
  };
  const [liveOn, setLiveOn] = useState(false);
  const [liveStatus, setLiveStatus] = useState<'idle' | 'listening' | 'speaking' | 'error'>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const liveOnRef = useRef(false);
  const voiceRequestInFlightRef = useRef(false);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load 8 token signals for this page
  useEffect(() => {
    async function loadSignals() {
      try {
        const res = await fetch('/api/signals?quote=USDC&limit=8');
        if (res.ok) {
          const data = await res.json();
          const list = (data.signals ?? []).slice(0, 8).map(
            (
              s: {
                id?: string;
                base?: string;
                symbol?: string;
                side?: string;
                score?: number;
                change24h?: number;
                signals?: string[];
              },
              i: number
            ) => ({
              id: s.id ?? String(i),
              symbol: s.base ?? s.symbol ?? '???',
              side: (s.side === 'SHORT' ? 'SHORT' : 'LONG') as 'LONG' | 'SHORT',
              score: s.score ?? 0,
              change24h: s.change24h ?? 0,
              note: Array.isArray(s.signals) ? s.signals.join(' · ') : 'Signal',
            })
          );
          setSignals(list);
        }
      } catch {
        // keep the last live list
      }
    }
    loadSignals();
    const t = setInterval(loadSignals, 30_000);
    return () => clearInterval(t);
  }, []);

  const sendChat = async () => {
    const text = input.trim();
    if (!text || requestInFlightRef.current || !historyReady) return;
    requestInFlightRef.current = true;
    setInput('');
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId: convRef.current,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Cletus is unavailable");
      if (data.conversationId) {
        convRef.current = data.conversationId;
        setConversationId(data.conversationId);
        void refreshConversations();
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.answer ?? data.message ?? 'Something went wrong. Try again.',
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Connection error. Please try again.' },
      ]);
    } finally {
      requestInFlightRef.current = false;
      setLoading(false);
    }
  };

  const speak = (text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onstart = () => setLiveStatus('speaking');
    u.onend = () => {
      setLiveStatus(liveOnRef.current ? 'listening' : 'idle');
      if (liveOnRef.current && recognitionRef.current && !voiceRequestInFlightRef.current) {
        try { recognitionRef.current.start(); } catch { /* already listening */ }
      }
    };
    window.speechSynthesis.speak(u);
  };

  const stopLive = useCallback(() => {
    liveOnRef.current = false;
    setLiveOn(false);
    setLiveStatus('idle');
    setLiveTranscript('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const startLive = useCallback(() => {
    const SR =
      typeof window !== 'undefined'
        ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        : null;
    if (!SR) {
      setLiveStatus('error');
      setLiveTranscript('Voice not supported in this browser. Use text chat.');
      return;
    }

    liveOnRef.current = true;
    setLiveOn(true);
    setLiveStatus('listening');
    setLiveTranscript('Listening… speak to Cletus');

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = async (event: SpeechRecognitionEvent) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const piece = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += piece;
      }
      if (!finalText.trim() || requestInFlightRef.current || voiceRequestInFlightRef.current || !liveOnRef.current || !historyReady) return;
      requestInFlightRef.current = true;
      voiceRequestInFlightRef.current = true;
      try { recognition.stop(); } catch { /* already stopped */ }

      setLiveTranscript(finalText.trim());
      setLiveStatus('speaking');

      const userLine = finalText.trim();
      setMessages((prev) => [...prev, { role: 'user', content: userLine }]);

      try {
        const res = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userLine, voice: true, conversationId: convRef.current }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Voice AI unavailable');
        if (data.conversationId) {
          convRef.current = data.conversationId;
          setConversationId(data.conversationId);
          void refreshConversations();
        }
        const answer =
          data.answer ?? data.message ?? "I didn't catch that. Try again.";
        setMessages((prev) => [...prev, { role: 'assistant', content: answer }]);
        speak(answer);
      } catch {
        const fail = 'Connection error on voice. Try text chat.';
        setMessages((prev) => [...prev, { role: 'assistant', content: fail }]);
        speak(fail);
      } finally {
        voiceRequestInFlightRef.current = false;
        requestInFlightRef.current = false;
      }
    };

    recognition.onerror = () => {
      liveOnRef.current = false;
      setLiveOn(false);
      setLiveStatus('error');
      setLiveTranscript('Mic error — check permissions or use text chat.');
    };

    recognition.onend = () => {
      if (recognitionRef.current === recognition && liveOnRef.current && !voiceRequestInFlightRef.current) {
        try {
          recognition.start();
        } catch {
          // ignore restart race
        }
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      liveOnRef.current = false;
      setLiveOn(false);
      setLiveStatus('error');
    }
  }, [historyReady, refreshConversations]);

  useEffect(() => {
    return () => stopLive();
  }, [stopLive]);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Logo on every page */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <Link href="/app" className="flex items-center gap-3">
            <Image
              src="/cletus-logo.png"
              alt="Cletus"
              width={40}
              height={40}
              className="object-contain"
              priority
            />
            <div>
              <div className="font-bold text-lg tracking-tight leading-none">Cletus</div>
              <div className="text-xs text-white/50 mt-0.5">Talk · Live · Signals</div>
            </div>
          </Link>
          <nav className="flex items-center gap-3 text-xs">
            <Link href="/app/signals" className="text-white/50 hover:text-white transition-colors">
              Signals
            </Link>
            <Link href="/app/community" className="text-white/50 hover:text-white transition-colors">
              Community
            </Link>
            <Link href="/app/chart" className="text-white/50 hover:text-white transition-colors">
              Chart
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 px-6 py-8">
        <div className="max-w-5xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Talk to Cletus</h1>
            <p className="text-sm text-white/50 mt-1">
              Text chat · <strong className="text-white/70">Cletus Live</strong> voice · his top{' '}
              <strong className="text-white/70">live scanner signals</strong> (USD prices)
            </p>
          </div>

          <section aria-label="Chat conversations" className="rounded-xl border border-white/10 p-3 flex flex-wrap gap-2 items-center">
            <button type="button" onClick={newConversation} className="rounded border border-white/20 px-3 py-2 text-xs">+ New chat</button>
            {conversations.slice(0, 12).map((c) => <button type="button" key={c.id} onClick={() => void selectConversation(c.id)} aria-current={conversationId === c.id ? 'true' : undefined} className={`rounded border px-3 py-2 text-xs ${conversationId === c.id ? 'border-amber-400' : 'border-white/20'}`}>{c.title}</button>)}
          </section>

          {/* 8 token signals from Cletus */}
          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Cletus live scanner · top {signals.length}
              </h2>
              <span className="text-xs font-mono text-[#d7b46d]">LATEST RECEIVED · NOT A LIVE-ENGINE GUARANTEE</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {signals.slice(0, 8).map((s) => (
                <div
                  key={s.id}
                  className="rounded-lg border border-white/10 bg-black/50 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm font-mono">{s.symbol}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                        s.side === 'LONG'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-red-500/15 text-red-400'
                      }`}
                    >
                      {s.side}
                    </span>
                  </div>
                  <div className="flex items-center justify-between mt-1 text-xs font-mono">
                    <span className="text-white/50">Score {s.score}</span>
                    <span
                      className={s.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}
                    >
                      {s.change24h >= 0 ? '+' : ''}
                      {s.change24h.toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[11px] text-white/40 mt-1 truncate">{s.note}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Text chat */}
            <section className="lg:col-span-3 flex flex-col rounded-xl border border-white/10 bg-[#0a0a0a] overflow-hidden min-h-[420px]">
              <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
                <span className="text-lg">🤖</span>
                <div>
                  <div className="text-sm font-semibold">Chat with Cletus</div>
                  <div className="text-xs text-white/40">Text · not financial advice</div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 max-h-[340px]">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        m.role === 'user'
                          ? 'bg-emerald-500 text-black rounded-br-md'
                          : 'bg-white/10 text-white/90 rounded-bl-md'
                      }`}
                    >
                      {m.content}
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-white/10 rounded-2xl px-4 py-3 text-xs text-white/40">
                      Cletus is thinking…
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <div className="p-3 border-t border-white/10 flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendChat();
                    }
                  }}
                  placeholder="Ask Cletus anything…"
                  className="flex-1 text-sm px-3 py-2.5 rounded-xl bg-black border border-white/15 text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-500/40"
                />
                <button
                  type="button"
                  onClick={sendChat}
                  disabled={loading || !input.trim()}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold bg-white text-black hover:bg-white/90 disabled:opacity-40 transition-all"
                >
                  Send
                </button>
              </div>
            </section>

            {/* Cletus Live — voice */}
            <section className="lg:col-span-2 space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-xl">🎙️</span>
                  <div>
                    <h2 className="text-sm font-bold">Cletus Live</h2>
                    <p className="text-xs text-white/50">Voice conversation</p>
                  </div>
                </div>

                <div
                  className={`rounded-xl border p-4 text-center ${
                    liveStatus === 'listening'
                      ? 'border-emerald-500/50 bg-emerald-500/10'
                      : liveStatus === 'speaking'
                      ? 'border-yellow-500/40 bg-yellow-500/10'
                      : liveStatus === 'error'
                      ? 'border-red-500/40 bg-red-500/10'
                      : 'border-white/10 bg-black/40'
                  }`}
                >
                  <div className="text-3xl mb-2">
                    {liveStatus === 'listening'
                      ? '👂'
                      : liveStatus === 'speaking'
                      ? '🗣️'
                      : liveStatus === 'error'
                      ? '⚠️'
                      : '🪿'}
                  </div>
                  <div className="text-xs font-mono uppercase tracking-wider text-white/50">
                    {liveStatus === 'idle' && 'Ready'}
                    {liveStatus === 'listening' && 'Listening'}
                    {liveStatus === 'speaking' && 'Cletus speaking'}
                    {liveStatus === 'error' && 'Unavailable'}
                  </div>
                  {liveTranscript && (
                    <p className="text-sm text-white/70 mt-2 leading-relaxed">
                      {liveTranscript}
                    </p>
                  )}
                </div>

                {!liveOn ? (
                  <button
                    type="button"
                    onClick={startLive}
                    className="w-full py-3 rounded-xl text-sm font-semibold bg-emerald-500 text-black hover:bg-emerald-400 transition-all"
                  >
                    Start Cletus Live
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopLive}
                    className="w-full py-3 rounded-xl text-sm font-semibold border border-red-500/40 text-red-400 hover:bg-red-500/10 transition-all"
                  >
                    End voice session
                  </button>
                )}

                <p className="text-[11px] text-white/35 leading-relaxed">
                  Uses your browser mic and speech APIs. Allow microphone access when prompted.
                  Voice replies also appear in the text chat. Not financial advice.
                </p>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs text-white/45 leading-relaxed">
                Cletus is software. Signals and chat are educational. You can lose money trading.
                Confirm anything important yourself.
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
