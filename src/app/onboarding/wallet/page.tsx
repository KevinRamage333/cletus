'use client';
import { useEffect, useState } from 'react';
import { Steps } from '../Steps';
import {
  generateMnemonic, keypairFromMnemonic, keypairFromSecret, isValidMnemonic, normalizeMnemonic,
  encryptSecret, decryptSecret, saveEncryptedWallet, loadEncryptedWallet, passwordProblem, pickConfirmIndices, type EncryptedWallet,
} from '@/lib/browser-wallet';

type Mode = 'create' | 'import' | 'existing';
type CreateStage = 'password' | 'show' | 'confirm';

async function register(publicKey: string, source: 'created' | 'imported') {
  // ONLY the public key is sent to the server.
  const r = await fetch('/api/onboarding/wallet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ publicKey, source }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? 'failed to record wallet');
  return j.next ?? '/';
}

export default function WalletPage() {
  const [mode, setMode] = useState<Mode>('create');
  const [existing, setExisting] = useState<EncryptedWallet | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // create
  const [stage, setStage] = useState<CreateStage>('password');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const [wroteDown, setWroteDown] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number[]>([]);
  const [confirmWords, setConfirmWords] = useState<Record<number, string>>({});
  // import
  const [secretInput, setSecretInput] = useState('');

  useEffect(() => { const w = loadEncryptedWallet(); if (w) { setExisting(w); setMode('existing'); } }, []);

  const pwOk = () => {
    const p = passwordProblem(pw);
    if (p) { setErr(p); return false; }
    if (pw !== pw2) { setErr('Passwords do not match.'); return false; }
    return true;
  };

  function startCreate() {
    setErr(null);
    if (!pwOk()) return;
    const m = generateMnemonic(12);
    setMnemonic(m);
    setConfirmIdx(pickConfirmIndices(12, 3));
    setStage('show');
  }

  async function finishCreate() {
    setErr(null);
    const words = mnemonic.split(' ');
    for (const i of confirmIdx) if ((confirmWords[i] ?? '').trim().toLowerCase() !== words[i]) return setErr(`Word #${i + 1} does not match. Check your written copy.`);
    setBusy(true);
    try {
      const kp = keypairFromMnemonic(mnemonic);
      const enc = await encryptSecret(mnemonic, pw, 'mnemonic', kp.publicKey.toBase58());
      saveEncryptedWallet(enc);
      setMnemonic(''); // the phrase is shown once and then dropped from memory
      window.location.href = await register(kp.publicKey.toBase58(), 'created');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function finishImport() {
    setErr(null);
    if (!pwOk()) return;
    setBusy(true);
    try {
      const input = secretInput.trim();
      let kp, kind: EncryptedWallet['kind'], secret: string;
      if (input.split(/\s+/).length >= 12) {
        if (!isValidMnemonic(input)) throw new Error('That recovery phrase is not a valid BIP39 phrase.');
        secret = normalizeMnemonic(input); kp = keypairFromMnemonic(secret); kind = 'mnemonic';
      } else {
        kp = keypairFromSecret(input); secret = input; kind = 'secretKey';
      }
      const enc = await encryptSecret(secret, pw, kind, kp.publicKey.toBase58());
      saveEncryptedWallet(enc);
      setSecretInput('');
      window.location.href = await register(kp.publicKey.toBase58(), 'imported');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function useExisting() {
    if (!existing) return;
    setErr(null); setBusy(true);
    try {
      await decryptSecret(existing, pw); // proves the user knows the password
      window.location.href = await register(existing.publicKey, 'imported');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const pwFields = (
    <>
      <label>Wallet password (encrypts the wallet in this browser)</label>
      <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      {mode !== 'existing' && (<><label>Confirm password</label><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></>)}
    </>
  );

  return (
    <div className="center-page">
      <div className="card narrow">
        <Steps at={3} />
        <h1>Set up your wallet</h1>
        <p className="muted">Your wallet is generated and encrypted <b>in this browser</b>. Cletus never receives your recovery phrase or private key — only the public address. During the beta all trading is simulated; do not send funds to this wallet for Cletus.</p>
        <div className="tabs">
          {existing && <button className={`btn small ${mode === 'existing' ? 'primary' : ''}`} onClick={() => { setMode('existing'); setErr(null); }}>Use stored wallet</button>}
          <button className={`btn small ${mode === 'create' ? 'primary' : ''}`} onClick={() => { setMode('create'); setErr(null); }}>Create new wallet</button>
          <button className={`btn small ${mode === 'import' ? 'primary' : ''}`} onClick={() => { setMode('import'); setErr(null); }}>Import existing</button>
        </div>

        {mode === 'existing' && existing && (
          <div>
            <p>A wallet is already stored in this browser: <span className="mono">{existing.publicKey}</span></p>
            {pwFields}
            <div style={{ marginTop: 14 }}><button className="btn primary" disabled={busy} onClick={useExisting}>Unlock &amp; continue</button></div>
          </div>
        )}

        {mode === 'create' && stage === 'password' && (
          <div>
            {pwFields}
            <div style={{ marginTop: 14 }}><button className="btn primary" onClick={startCreate}>Generate wallet</button></div>
          </div>
        )}
        {mode === 'create' && stage === 'show' && (
          <div>
            <p className="amber"><b>Write down these 12 words in order and store them offline.</b> This is the only time they are shown. Anyone with them controls the wallet; if you lose them and your password, the wallet cannot be recovered.</p>
            <div className="phrase" data-testid="phrase">{mnemonic.split(' ').map((w, i) => <div key={i}><span className="muted">{i + 1}.</span> {w}</div>)}</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text)' }}>
              <input type="checkbox" style={{ width: 18 }} checked={wroteDown} onChange={(e) => setWroteDown(e.target.checked)} /> I have written down my recovery phrase
            </label>
            <div style={{ marginTop: 14 }}><button className="btn primary" disabled={!wroteDown} onClick={() => setStage('confirm')}>Next: confirm phrase</button></div>
          </div>
        )}
        {mode === 'create' && stage === 'confirm' && (
          <div>
            <p>Confirm your recovery phrase by entering the requested words.</p>
            {confirmIdx.map((i) => (
              <div key={i}><label>Word #{i + 1}</label><input value={confirmWords[i] ?? ''} onChange={(e) => setConfirmWords({ ...confirmWords, [i]: e.target.value })} autoComplete="off" /></div>
            ))}
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setStage('show')}>Back</button>
              <button className="btn primary" disabled={busy} onClick={finishCreate}>Confirm &amp; finish</button>
            </div>
          </div>
        )}

        {mode === 'import' && (
          <div>
            <label>Recovery phrase (12/24 words) or base58 / JSON secret key</label>
            <textarea rows={3} value={secretInput} onChange={(e) => setSecretInput(e.target.value)} autoComplete="off" spellCheck={false} />
            {pwFields}
            <div style={{ marginTop: 14 }}><button className="btn primary" disabled={busy || !secretInput} onClick={finishImport}>Import &amp; finish</button></div>
          </div>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </div>
  );
}
