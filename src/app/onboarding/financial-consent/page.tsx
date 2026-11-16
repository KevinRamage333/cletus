'use client';

import { useEffect, useState } from 'react';
import { FINANCIAL_CONSENT_STAGES, FINANCIAL_CONSENT_VERSION, type FinancialConsentStageId } from '@/lib/financial-consent';
import { Steps } from '../Steps';

type Progress = { nextStage: FinancialConsentStageId | null; completedCount: number; totalStages: number };

export default function FinancialConsentPage() {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [answer, setAnswer] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/onboarding/financial-consent')
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error ?? 'Could not load consent progress.');
        if (active) setProgress(data as Progress);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load consent progress.'); });
    return () => { active = false; };
  }, []);

  const stage = progress?.nextStage
    ? FINANCIAL_CONSENT_STAGES.find((item) => item.id === progress.nextStage)
    : undefined;

  async function continueStage() {
    if (!stage || !answer || !confirmed) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/onboarding/financial-consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: FINANCIAL_CONSENT_VERSION, stage: stage.id, answer, confirmed }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? 'Could not record this stage.');
      if (!data.nextStage) {
        window.location.href = data.next ?? '/onboarding/wallet';
        return;
      }
      setProgress({ nextStage: data.nextStage, completedCount: data.completedCount, totalStages: data.totalStages });
      setAnswer('');
      setConfirmed(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not record this stage.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <div className="card narrow" style={{ maxWidth: 760 }}>
        <Steps at={3} />
        <h1>Financial understanding</h1>
        <p className="muted">Five short stages before any wallet connection. This is designed to check understanding, not rush you through a disclaimer.</p>
        {!progress && !error && <p className="muted">Loading your progress…</p>}
        {error && <div className="err" role="alert">{error}</div>}
        {stage && progress && (
          <>
            <div className="badge ok" style={{ marginTop: 12 }}>Stage {progress.completedCount + 1} of {progress.totalStages}</div>
            <h2 style={{ marginTop: 18, color: 'var(--text)', textTransform: 'none' }}>{stage.title}</h2>
            <p style={{ lineHeight: 1.7, margin: '12px 0 20px' }}>{stage.explanation}</p>
            <h3>{stage.question}</h3>
            <fieldset style={{ border: 0, padding: 0, margin: '14px 0' }}>
              <legend className="muted">Choose the statement that best reflects what you understand.</legend>
              {stage.options.map((option) => (
                <label key={option.value} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: 10, border: '1px solid var(--border)', borderRadius: 8, marginTop: 8, color: 'var(--text)' }}>
                  <input
                    type="radio"
                    name={stage.id}
                    value={option.value}
                    checked={answer === option.value}
                    onChange={() => setAnswer(option.value)}
                    style={{ width: 18, marginTop: 2 }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 16, color: 'var(--text)' }}>
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} style={{ width: 18, marginTop: 2 }} />
              <span>{stage.confirmation}</span>
            </label>
            <button className="btn primary" disabled={!answer || !confirmed || busy} onClick={continueStage} style={{ marginTop: 18 }}>
              {busy ? 'Recording…' : 'Continue'}
            </button>
          </>
        )}
        {progress && !stage && (
          <>
            <p style={{ marginTop: 18 }}>All five stages are complete. You may continue to the optional wallet step or choose paper mode.</p>
            <a className="btn primary" href="/onboarding/wallet" style={{ display: 'inline-block', marginTop: 16 }}>Continue to wallet choices</a>
          </>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 18 }}>Version {FINANCIAL_CONSENT_VERSION}. You may stop here and sign out at any time.</p>
        <a href="/api/auth/logout" className="muted" style={{ display: 'inline-block', marginTop: 8 }}>Leave onboarding</a>
      </div>
    </div>
  );
}
