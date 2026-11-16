'use client';
import { useState } from 'react';
import { RISK_POINTS, RISK_VERSION } from '@/lib/legal';
import { Steps } from '../Steps';

export default function RiskPage() {
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function ack() {
    setBusy(true); setErr(null);
    const r = await fetch('/api/onboarding/risk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: RISK_VERSION, acknowledged: true }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? 'failed');
    window.location.href = j.next ?? '/onboarding/financial-consent';
  }
  return (
    <div className="risk-page">
      <Steps at={3} />
      <h1 style={{ fontSize: 40, color: '#fca5a5' }}>⚠️ Risk Disclosure</h1>
      <p style={{ fontSize: 22, fontWeight: 800, maxWidth: 820, textAlign: 'center' }}>The only guarantee is that you can lose money — including all the money you choose to put at risk.</p>
      <p style={{ fontSize: 18, maxWidth: 820, textAlign: 'center' }}>Read this carefully. Trading crypto micro-caps with an automated bot is extremely risky.</p>
      <ul>{RISK_POINTS.map((p) => <li key={p}>{p}</li>)}</ul>
      {err && <div className="err">{err}</div>}
      <button className="btn danger" style={{ fontSize: 18, padding: '12px 28px', marginTop: 16 }} disabled={busy} onClick={ack}>Acknowledge</button>
      <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>Version {RISK_VERSION}. Your acknowledgement is recorded with a timestamp.</p>
    </div>
  );
}
