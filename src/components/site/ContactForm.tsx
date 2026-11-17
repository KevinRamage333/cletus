'use client';
import { useEffect, useState } from 'react';

const TOPICS = [['benefactor', 'Benefactor / sponsorship'], ['partner', 'Strategic partnership'], ['developer', 'Developers & integrations'], ['security', 'Security report'], ['press', 'Press'], ['other', 'Other']] as const;

/** Composes a message for the published inbox. If no inbox is configured, says so instead of pretending to send. */
export default function ContactForm({ email }: { email: string }) {
  const [topic, setTopic] = useState<string>('benefactor');
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'invalid' | 'opened' | 'copied' | 'no-inbox'>('idle');
  useEffect(() => { const t = new URLSearchParams(window.location.search).get('topic'); if (t && TOPICS.some(([id]) => id === t)) setTopic(t); }, []);
  const valid = name.trim().length > 1 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from) && message.trim().length >= 10;
  const body = `${message.trim()}\n\n— ${name.trim()} <${from.trim()}>`;
  const subject = `[Cletus] ${TOPICS.find(([id]) => id === topic)?.[1] ?? 'Contact'}`;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) { setStatus('invalid'); return; }
    if (!email) { setStatus('no-inbox'); return; }
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setStatus('opened');
  };
  const copy = async () => { try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setStatus('copied'); } catch { /* clipboard blocked */ } };
  return (
    <form onSubmit={submit} className="panel panel-hi space-y-4 p-6" data-testid="contact-form" noValidate>
      <div><label htmlFor="topic" className="mb-1 block text-xs font-semibold uppercase tracking-[.14em] text-[#c9a24a]">Topic</label>
        <select id="topic" className="field" value={topic} onChange={(e) => setTopic(e.target.value)}>{TOPICS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="name" className="mb-1 block text-xs font-semibold uppercase tracking-[.14em] text-[#c9a24a]">Name</label><input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>
        <div><label htmlFor="email" className="mb-1 block text-xs font-semibold uppercase tracking-[.14em] text-[#c9a24a]">Email</label><input id="email" type="email" className="field" value={from} onChange={(e) => setFrom(e.target.value)} autoComplete="email" /></div>
      </div>
      <div><label htmlFor="message" className="mb-1 block text-xs font-semibold uppercase tracking-[.14em] text-[#c9a24a]">Message</label><textarea id="message" rows={6} className="field" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="How would you like to work with Cletus?" /></div>
      <p className="text-xs text-[#8a8478]">Never include private keys, seed phrases or passwords.</p>
      <div className="flex flex-wrap gap-3"><button type="submit" className="btn-gold">Send message</button><button type="button" className="btn-line" onClick={copy} disabled={!valid}>Copy message</button></div>
      <div role="status" aria-live="polite" className="text-sm">
        {status === 'invalid' && <p className="text-red-300">Please add your name, a valid email and a message of at least 10 characters.</p>}
        {status === 'opened' && <p className="text-emerald-300">Your email app should open with the message ready to send.</p>}
        {status === 'copied' && <p className="text-emerald-300">Message copied.</p>}
        {status === 'no-inbox' && <p className="text-[#e3c06a]" data-testid="contact-not-connected">The public contact inbox is not connected yet, so nothing was sent. Use “Copy message” and keep it until the inbox is published here.</p>}
      </div>
    </form>
  );
}
