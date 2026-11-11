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
    <div className="center-page">
      <form className="card narrow" style={{ maxWidth: 440 }} onSubmit={submit}>
        <h1>Cletus <span className="badge sim">BETA</span></h1>
        <p className="muted">Autonomous Solana micro-cap trader. The beta runs in <b>simulation mode</b>: real market data, paper trades, no real funds.</p>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        <label htmlFor="invite">Beta invite code (if you were given one)</label>
        <input id="invite" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="optional" />
        {err && <div className="err">{err}</div>}
        <div style={{ marginTop: 16 }}><button className="btn primary" disabled={busy}>Continue</button></div>
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>Next you will read the Terms and Conditions, acknowledge the Risk Disclaimer, and set up a wallet before you can use the app.</p>
      </form>
    </div>
  );
}
