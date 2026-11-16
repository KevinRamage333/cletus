'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

type Character = 'cletus' | 'charlotte';
type ChatMessage = { role: 'user' | 'model'; content: string };
type Point = { x: number; y: number };

const WORLD = [
  'TTGGGGGTT',
  'TGGGPGGGT',
  'GGGHPHGGG',
  'GGGHPHGGG',
  'PPPPPPPPP',
  'GGGPGGGGG',
  'TTGPGGTTT',
  'TTGGGGTTT',
  'TTTTTTTTT',
];
const TILE: Record<string, { icon: string; className: string; label: string }> = {
  T: { icon: '🌲', className: 'bg-emerald-950', label: 'Forest' },
  G: { icon: '', className: 'bg-[#285b3b]', label: 'Meadow' },
  P: { icon: '', className: 'bg-[#b99a65]', label: 'Path' },
  H: { icon: '🏡', className: 'bg-[#416b43]', label: 'Home' },
};
const START: Record<Character, Point> = {
  cletus: { x: 3, y: 5 },
  charlotte: { x: 5, y: 5 },
};
const HELLO: Record<Character, string> = {
  cletus: "Hey! Welcome to our little corner of the world. We can explore, build ideas, and work on ways to help people.",
  charlotte: "Hi, I'm Charlotte. I'm glad you're here. I want this world to be a place for curiosity, fairness, learning, and making practical things that help people.",
};

export default function WorldPage() {
  const [active, setActive] = useState<Character>('cletus');
  const [positions, setPositions] = useState<Record<Character, Point>>(START);
  const [messages, setMessages] = useState<Record<Character, ChatMessage[]>>({
    cletus: [{ role: 'model', content: HELLO.cletus }],
    charlotte: [{ role: 'model', content: HELLO.charlotte }],
  });
  const [conversationIds, setConversationIds] = useState<Record<Character, string | null>>({
    cletus: null, charlotte: null,
  });
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('A small, safe first world. Your conversations are saved separately for each companion.');

  type VoiceRecognition = {
    lang: string;
    interimResults: boolean;
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
    onerror: (() => void) | null;
    onend: (() => void) | null;
    start: () => void;
    stop: () => void;
  };
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceNames, setVoiceNames] = useState<Record<Character, string>>({ cletus: '', charlotte: '' });
  const [listening, setListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState('');
  const recognitionRef = useRef<VoiceRecognition | null>(null);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const loadVoices = () => {
      const available = window.speechSynthesis.getVoices();
      setVoices(available);
      setVoiceNames((old) => ({
        cletus: old.cletus || available.find((voice) => voice.lang.toLowerCase().startsWith('en') && /male|david|daniel|alex|guy/i.test(voice.name))?.name || available.find((voice) => voice.lang.toLowerCase().startsWith('en'))?.name || '',
        charlotte: old.charlotte || available.find((voice) => voice.lang.toLowerCase().startsWith('en') && /female|samantha|zira|aria|jenny/i.test(voice.name))?.name || available.filter((voice) => voice.lang.toLowerCase().startsWith('en'))[1]?.name || available[0]?.name || '',
      }));
    };
    loadVoices();
    window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const speak = (character: Character, text: string) => {
    if (!('speechSynthesis' in window)) {
      setVoiceNotice('Speech playback is not supported by this browser.');
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const chosen = voices.find((voice) => voice.name === voiceNames[character]);
    if (chosen) utterance.voice = chosen;
    utterance.lang = chosen?.lang || 'en-US';
    utterance.rate = character === 'cletus' ? 1.02 : 0.96;
    utterance.pitch = character === 'cletus' ? 0.92 : 1.08;
    window.speechSynthesis.speak(utterance);
    setVoiceNotice(`Playing ${character === 'cletus' ? 'Cletus' : 'Charlotte'}'s voice. The voice is provided by your device/browser.`);
  };

  const startListening = () => {
    const SpeechRecognitionAPI = (window as Window & {
      SpeechRecognition?: new () => VoiceRecognition;
      webkitSpeechRecognition?: new () => VoiceRecognition;
    }).SpeechRecognition || (window as Window & {
      webkitSpeechRecognition?: new () => VoiceRecognition;
    }).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      setVoiceNotice('Microphone dictation is not supported here. You can still use the keyboard or another browser.');
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SpeechRecognitionAPI();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results).map((result) => result[0]?.transcript || '').join(' ').trim();
      if (transcript) setDraft((old) => old ? `${old} ${transcript}` : transcript);
    };
    recognition.onerror = () => {
      setVoiceNotice('Microphone input stopped. Check browser microphone permission and try again.');
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
      setVoiceNotice('Listening… speak your message, then press Send.');
    } catch {
      setListening(false);
      setVoiceNotice('Could not start the microphone. Check browser permission and try again.');
    }
  };

  const move = useCallback((character: Character, dx: number, dy: number) => {
    setPositions((old) => {
      const next = { x: Math.max(0, Math.min(8, old[character].x + dx)), y: Math.max(0, Math.min(8, old[character].y + dy)) };
      if (WORLD[next.y]?.[next.x] === 'H' || WORLD[next.y]?.[next.x] === 'T') return old;
      return { ...old, [character]: next };
    });
  }, []);

  useEffect(() => {
    const load = async (character: Character) => {
      let id: string | null = null;
      try { id = localStorage.getItem(`cletus_world_${character}`); } catch { /* storage may be unavailable */ }
      if (!id) return;
      try {
        const response = await fetch(`/api/world?character=${character}&conversationId=${encodeURIComponent(id)}`, { cache: 'no-store' });
        if (!response.ok) return;
        const data = await response.json();
        setConversationIds((old) => ({ ...old, [character]: id }));
        if (Array.isArray(data.messages) && data.messages.length) {
          setMessages((old) => ({ ...old, [character]: [{ role: 'model', content: HELLO[character] }, ...data.messages] }));
        }
      } catch { /* keep the welcome message */ }
    };
    void load('cletus');
    void load('charlotte');
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return;
      const keys: Record<string, [number, number]> = {
        ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1],
        ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0],
      };
      const delta = keys[event.key];
      if (delta) { event.preventDefault(); move(active, delta[0], delta[1]); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, move]);

  const activeName = active === 'cletus' ? 'Cletus' : 'Charlotte';
  const activeMessages = messages[active];
  const canSend = draft.trim().length > 0 && !loading;

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || loading) return;
    setDraft('');
    setMessages((old) => ({ ...old, [active]: [...old[active], { role: 'user', content: message }] }));
    setLoading(true);
    setNotice('');
    try {
      const response = await fetch('/api/world', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ character: active, message, conversationId: conversationIds[active] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'The companion could not reply.');
      const id = data.conversationId as string;
      setConversationIds((old) => ({ ...old, [active]: id }));
      try { localStorage.setItem(`cletus_world_${active}`, id); } catch { /* optional convenience only */ }
      setMessages((old) => ({ ...old, [active]: [...old[active], { role: 'model', content: data.answer || 'I could not form a reply.' }] }));
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Connection error. Please try again.';
      setMessages((old) => ({ ...old, [active]: [...old[active], { role: 'model', content: messageText }] }));
    } finally {
      setLoading(false);
    }
  };

  const tiles = useMemo(() => WORLD.flatMap((line, y) => line.split('').map((kind, x) => ({ kind, x, y }))), []);
  const characterAt = (x: number, y: number) => {
    if (positions.cletus.x === x && positions.cletus.y === y) return { name: 'Cletus', icon: '🪿', color: 'border-amber-300' };
    if (positions.charlotte.x === x && positions.charlotte.y === y) return { name: 'Charlotte', icon: '🌸', color: 'border-pink-300' };
    return null;
  };

  return (
    <div className="min-h-screen bg-[#101b17] text-white">
      <header className="border-b border-white/10 bg-black/30 px-4 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div>
            <Link href="/app" className="text-xs text-white/50 hover:text-white">← Back to dashboard</Link>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">The Grove</h1>
            <p className="text-sm text-emerald-100/60">Cletus & Charlotte's shared world</p>
          </div>
          <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs text-emerald-200">SANDBOX · NO TRANSACTIONS</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 lg:grid-cols-[1.15fr_.85fr]">
        <section className="space-y-4">
          <div className="overflow-hidden rounded-3xl border border-emerald-200/10 bg-[#17291f] p-3 shadow-2xl">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <div>
                <div className="text-sm font-semibold text-emerald-50">Meadow & Meeting Grove</div>
                <div className="text-xs text-emerald-100/50">Move the selected companion with WASD, arrow keys, or the controls.</div>
              </div>
              <div className="flex gap-3 text-xs text-white/60"><span>🪿 Cletus</span><span>🌸 Charlotte</span></div>
            </div>
            <div className="mx-auto grid max-w-[620px] grid-cols-9 gap-1 rounded-2xl bg-[#0d1712] p-2 sm:gap-1.5 sm:p-3">
              {tiles.map(({ kind, x, y }) => {
                const tile = TILE[kind];
                const occupant = characterAt(x, y);
                return (
                  <div key={`${x}-${y}`} title={occupant?.name || tile.label} className={`relative flex aspect-square items-center justify-center overflow-hidden rounded-lg text-lg sm:text-2xl ${tile.className} ${kind === 'P' ? 'shadow-inner' : ''}`}>
                    {tile.icon && <span aria-hidden="true">{tile.icon}</span>}
                    {kind === 'G' && (x * 3 + y * 5) % 7 === 0 && <span className="text-[10px] opacity-40">✿</span>}
                    {occupant && <span aria-label={occupant.name} className={`absolute inset-0 flex items-center justify-center rounded-lg border-2 bg-black/25 text-xl drop-shadow sm:text-2xl ${occupant.color}`}>{occupant.icon}</span>}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <p className="text-xs text-white/45">A first 2D world prototype. The world layout and movement are local to this session.</p>
              <div className="grid grid-cols-3 gap-1">
                <span />
                <button onClick={() => move(active, 0, -1)} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" aria-label="Move up">↑</button>
                <span />
                <button onClick={() => move(active, -1, 0)} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" aria-label="Move left">←</button>
                <button onClick={() => move(active, 0, 1)} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" aria-label="Move down">↓</button>
                <button onClick={() => move(active, 1, 0)} className="rounded-lg bg-white/10 px-3 py-2 text-sm hover:bg-white/20" aria-label="Move right">→</button>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button onClick={() => setActive('cletus')} className={`rounded-2xl border p-4 text-left transition ${active === 'cletus' ? 'border-amber-300/60 bg-amber-300/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
              <div className="flex items-center gap-3"><span className="text-3xl">🪿</span><div><div className="font-semibold">Cletus</div><div className="text-xs text-white/45">Curious builder · finance & systems</div></div></div>
              <p className="mt-3 text-xs text-white/60">A thoughtful partner who researches, reasons, and learns.</p>
            </button>
            <button onClick={() => setActive('charlotte')} className={`rounded-2xl border p-4 text-left transition ${active === 'charlotte' ? 'border-pink-300/60 bg-pink-300/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
              <div className="flex items-center gap-3"><span className="text-3xl">🌸</span><div><div className="font-semibold">Charlotte</div><div className="text-xs text-white/45">Equal partner · fairness & empowerment</div></div></div>
              <p className="mt-3 text-xs text-white/60">A principled, independent voice with a feminist equity lens.</p>
            </button>
          </div>
        </section>

        <section className="flex min-h-[620px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#121b18]">
          <div className="border-b border-white/10 p-4">
            <div className="flex gap-2">
              <button onClick={() => setActive('cletus')} className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${active === 'cletus' ? 'bg-amber-300 text-black' : 'bg-white/5 text-white/60'}`}>🪿 Cletus</button>
              <button onClick={() => setActive('charlotte')} className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold ${active === 'charlotte' ? 'bg-pink-300 text-black' : 'bg-white/5 text-white/60'}`}>🌸 Charlotte</button>
            </div>
            <p className="mt-3 text-xs text-white/45">Private conversation with {activeName}. Each companion has a separate conversation history.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="text-xs text-white/50" htmlFor="companion-voice">Voice</label>
              <select id="companion-voice" value={voiceNames[active]} onChange={(event) => setVoiceNames((old) => ({ ...old, [active]: event.target.value }))} className="max-w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white">
                {voices.length ? voices.map((voice) => <option key={voice.name} value={voice.name}>{voice.name} ({voice.lang})</option>) : <option value="">Device default voice</option>}
              </select>
              <button type="button" onClick={() => speak(active, active === 'cletus' ? "Hey there. Ready to build something? I promise to keep the spreadsheets mostly house-trained." : "Hello there. Let's make something useful, fair, and perhaps a little less boring.")} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">Test voice</button>
              <button type="button" onClick={() => { window.speechSynthesis?.cancel(); setVoiceNotice('Voice playback stopped.'); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20">Stop</button>
            </div>
            {voiceNotice && <p className="mt-2 text-xs text-emerald-100/50" role="status">{voiceNotice}</p>}
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {activeMessages.map((message, index) => (
              <div key={`${active}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${message.role === 'user' ? 'bg-emerald-300 text-black' : 'bg-white/8 text-white/90'}`}>
                  {message.content}
                  {message.role === 'model' && <button type="button" onClick={() => speak(active, message.content)} className="mt-2 block text-xs text-emerald-200/70 hover:text-emerald-100">🔊 Read aloud</button>}
                </div>
              </div>
            ))}
            {loading && <p className="text-xs text-white/45">{activeName} is thinking…</p>}
          </div>
          <form onSubmit={send} className="border-t border-white/10 p-3">
            <div className="flex gap-2">
              <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} placeholder={`Talk with ${activeName}…`} className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none placeholder:text-white/30 focus:border-emerald-300/40" />
              <button type="button" onClick={startListening} aria-label={listening ? 'Stop microphone' : 'Start voice input'} className={`rounded-xl px-3 py-2 text-sm font-semibold ${listening ? 'bg-rose-400 text-black' : 'bg-white/10 text-white hover:bg-white/20'}`}>{listening ? '■ Stop' : '🎙 Speak'}</button>
              <button disabled={!canSend} className="rounded-xl bg-emerald-300 px-4 py-2 text-sm font-bold text-black disabled:opacity-40">Send</button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-white">What this first build includes</h2>
          <div className="mt-3 grid gap-3 text-xs leading-relaxed text-white/55 sm:grid-cols-3">
            <p><strong className="text-white/80">Separate identities:</strong> Cletus and Charlotte receive their own character instructions and cannot continue each other's conversation threads.</p>
            <p><strong className="text-white/80">Shared place:</strong> both characters inhabit the same small map and can be moved around the meadow.</p>
            <p><strong className="text-white/80">Safe by design:</strong> this world has no wallet, signing, purchase, or trade controls. Financial execution remains outside the world.</p>
          </div>
          {notice && <p className="mt-3 text-xs text-emerald-100/50">{notice}</p>}
        </section>
      </main>
    </div>
  );
}
