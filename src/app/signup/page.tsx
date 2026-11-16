'use client';
import { useState } from 'react';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, inviteCode }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? 'sign-up failed');
    window.location.href = j.next ?? '/';
  }

  return (
    <div className="landing">
      <div className="hero-copy">
        <div className="brand"><img src="/cletus-logo.png" alt="Cletus logo" /><span className="badge sim">BETA</span></div>
        <h1 style={{ marginTop: 14 }}>Cletus,<br />the golden goose.</h1>
        <p className="tag">An autonomous, self-learning, self-healing trading system for Solana tokens. He scans the market, audits every token, sizes every trade, and learns from each result. You can talk to his Brain, and he keeps up with world events.</p>
        <div className="stack"><span>Solana</span><span>Helius</span><span>Jupiter</span><span>DexScreener</span><span>RugCheck</span><span>Gemini by Google</span><span>Grok by xAI</span><span>Next.js</span></div>
        <p className="muted" style={{ fontSize: 12, maxWidth: 520 }}>18+ only. Crypto trading is risky. The only guarantee is that you can lose money, including all funds you choose to put at risk. No profit, income, or return is guaranteed. The beta runs in simulation mode: real market data, paper trades, no real funds.</p>
      </div>
      <form className="card" onSubmit={submit}>
        <h2 style={{ color: 'var(--gold)' }}>Join the beta</h2>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <label htmlFor="invite">Beta invite code (if you were given one)</label>
        <input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="optional" />
        {err && <div className="err">{err}</div>}
        <div style={{ marginTop: 16 }}><button className="btn primary" disabled={busy}>Continue</button></div>
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>You must be at least 18 and legally permitted to use Cletus where you live. After sign-up, you must confirm age eligibility, read the Terms, acknowledge the loss-risk disclosure, and complete five understanding stages before the app or wallet step. Wallet connection is optional; Cletus never holds your keys.</p>
      </form>
    </div>
  );
}
