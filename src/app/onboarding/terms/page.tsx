'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { TERMS_SECTIONS, TERMS_VERSION } from '@/lib/legal';
import { Steps } from '../Steps';

export default function TermsPage() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [readConfirmed, setReadConfirmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(() => {
    const el = boxRef.current;
    if (el && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) setScrolledToEnd(true);
  }, []);
  useEffect(() => { check(); }, [check]);

  async function accept() {
    setBusy(true); setErr(null);
    const r = await fetch('/api/onboarding/terms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: TERMS_VERSION, scrolledToEnd, readConfirmed }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return setErr(j.error ?? 'failed');
    window.location.href = j.next ?? '/onboarding/risk';
  }

  return (
    <div className="center-page">
      <div className="card narrow" style={{ maxWidth: 880 }}>
        <Steps at={2} />
        <h1>Terms and Conditions</h1>
        <p className="muted">Version {TERMS_VERSION}. Scroll through the entire document to enable acceptance.</p>
        <div className="terms-box" ref={boxRef} onScroll={check} data-testid="terms-box">
          {TERMS_SECTIONS.map((s) => (
            <section key={s.title}>
              <h3>{s.title}</h3>
              {s.body.map((p, i) => <p key={i}>{p}</p>)}
            </section>
          ))}
          <p className="muted" id="terms-end"><i>— End of Terms and Conditions (version {TERMS_VERSION}) —</i></p>
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: scrolledToEnd ? 'var(--text)' : 'var(--muted)', marginTop: 14 }}>
          <input type="checkbox" style={{ width: 18 }} disabled={!scrolledToEnd} checked={readConfirmed} onChange={(e) => setReadConfirmed(e.target.checked)} />
          I have read the entire Terms and Conditions
        </label>
        {!scrolledToEnd && <div className="muted" style={{ fontSize: 12 }}>Scroll to the end of the terms to continue.</div>}
        {err && <div className="err">{err}</div>}
        <div style={{ marginTop: 14, display: 'flex', gap: 10 }}>
          <button className="btn primary" disabled={!scrolledToEnd || !readConfirmed || busy} onClick={accept}>Accept</button>
          <form action="/api/auth/logout" method="post"><button type="submit" className="btn">Decline &amp; sign out</button></form>
        </div>
      </div>
    </div>
  );
}
