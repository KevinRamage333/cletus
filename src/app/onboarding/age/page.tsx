'use client';
import { useState } from 'react';
import { AGE_ATTESTATION_VERSION } from '@/lib/age';
import { Steps } from '../Steps';

export default function AgeEligibilityPage() {
  const [confirmed18Plus, setConfirmed18Plus] = useState(false);
  const [legallyPermitted, setLegallyPermitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/onboarding/age', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: AGE_ATTESTATION_VERSION, confirmed18Plus, legallyPermitted }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not record age eligibility.');
      window.location.href = data.next ?? '/onboarding/terms';
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record age eligibility.');
    } finally { setBusy(false); }
  }

  return (
    <div className="center-page">
      <div className="card narrow" style={{ maxWidth: 720 }}>
        <Steps at={1} />
        <h1>Age eligibility — 18+</h1>
        <p style={{ lineHeight: 1.7 }}>Cletus is restricted to adults aged 18 or older. You must also be legally permitted to access digital-asset and automated-trading software where you live.</p>
        <p className="muted">We do not ask for or store your date of birth in this step. We record your eligibility confirmation, its version and the time you made it. This is a self-attestation, not identity or age verification.</p>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18 }}>
          <input type="checkbox" checked={confirmed18Plus} onChange={e => setConfirmed18Plus(e.target.checked)} style={{ width: 18, marginTop: 3 }} />
          <span>I confirm that I am at least 18 years old.</span>
        </label>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14 }}>
          <input type="checkbox" checked={legallyPermitted} onChange={e => setLegallyPermitted(e.target.checked)} style={{ width: 18, marginTop: 3 }} />
          <span>I confirm that I am legally permitted to use Cletus and digital-asset services in my jurisdiction.</span>
        </label>
        {error && <div className="err" role="alert">{error}</div>}
        <button className="btn primary" disabled={!confirmed18Plus || !legallyPermitted || busy} onClick={submit} style={{ marginTop: 20 }}>{busy ? 'Recording…' : 'Confirm and continue'}</button>
        <a href="/api/auth/logout" className="muted" style={{ display: 'block', marginTop: 16 }}>I do not meet these requirements — leave</a>
        <p className="muted" style={{ fontSize: 12, marginTop: 16 }}>Eligibility attestation version {AGE_ATTESTATION_VERSION}.</p>
      </div>
    </div>
  );
}
