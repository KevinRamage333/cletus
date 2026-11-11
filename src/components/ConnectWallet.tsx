'use client';
import { Buffer } from 'buffer';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet, type Wallet } from '@solana/wallet-adapter-react';
import { WalletReadyState, type WalletName } from '@solana/wallet-adapter-base';
import {
  SUPPORTED_WALLETS, WALLET_CONNECT_COPY, JUPITER_MOBILE_STEPS,
  isMobileUserAgent, inWalletBrowser, findSupportedAdapter, extraDetectedWallets,
  type SupportedWallet,
} from '@/lib/connect-wallets';

export type ConnectMode = 'onboarding' | 'demo' | 'settings' | 'owner';

type Props = {
  mode: ConnectMode;
  currentPublicKey?: string | null;
  source?: string | null;
  onPaper?: () => void;
  onConnected?: (publicKey: string) => void;
  onDisconnected?: () => void;
};

function currentPageUrl() {
  if (typeof window === 'undefined') return '';
  return window.location.href;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const el = document.createElement('textarea');
      el.value = text;
      el.setAttribute('readonly', '');
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      document.body.appendChild(el);
      el.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(el);
      return ok;
    } catch {
      return false;
    }
  }
}

export default function ConnectWallet({ mode, currentPublicKey, source, onPaper, onConnected, onDisconnected }: Props) {
  const { wallets, select, connect, disconnect, publicKey, signMessage, connected, wallet, connecting } = useWallet();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [insideWallet, setInsideWallet] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showJupiterHint, setShowJupiterHint] = useState(false);
  const pendingSelect = useRef<WalletName | null>(null);
  const siwsStarted = useRef(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    setMobile(isMobileUserAgent(ua));
    setInsideWallet(inWalletBrowser(ua));
  }, []);

  const extras = useMemo(() => extraDetectedWallets(wallets), [wallets]);

  const finishConnected = useCallback(async (pk: string) => {
    if (mode === 'demo') {
      try { sessionStorage.setItem('cletus.demo.wallet', pk); } catch { /* ignore */ }
      onConnected?.(pk);
      return;
    }
    setBusy(true); setErr(null);
    try {
      const challengeUrl = mode === 'owner'
        ? `/api/owner/challenge?publicKey=${encodeURIComponent(pk)}`
        : `/api/onboarding/wallet/challenge?publicKey=${encodeURIComponent(pk)}`;
      const ch = await fetch(challengeUrl, { credentials: 'include' });
      const cj = await ch.json().catch(() => ({}));
      if (!ch.ok) throw new Error(cj.error ?? 'could not start sign-in');
      if (!signMessage) throw new Error('this wallet cannot sign a message');
      const sig = await signMessage(new TextEncoder().encode(cj.message as string));
      const signature = Buffer.from(sig).toString('base64');
      const endpoint = mode === 'owner' ? '/api/owner/login' : '/api/onboarding/wallet';
      const r = await fetch(endpoint, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'connected', publicKey: pk, message: cj.message, signature, challenge: cj.challenge }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? (mode === 'owner' ? 'this wallet is not the owner wallet' : 'could not record wallet'));
      onConnected?.(pk);
      if ((mode === 'onboarding' || mode === 'owner') && j.next) window.location.href = j.next;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      siwsStarted.current = false;
    }
  }, [mode, onConnected, signMessage]);

  useEffect(() => {
    if (pendingSelect.current && wallet?.adapter.name === pendingSelect.current && !connected && !connecting) {
      pendingSelect.current = null;
      connect().catch((e) => setErr((e as Error).message));
    }
  }, [wallet, connected, connecting, connect]);

  useEffect(() => {
    if (connected && publicKey && !siwsStarted.current && (mode === 'onboarding' || mode === 'settings' || mode === 'demo' || mode === 'owner')) {
      // Demo: optional preview connect without an account. Onboarding/settings: SIWS.
      if (mode === 'settings' && currentPublicKey === publicKey.toBase58()) return;
      siwsStarted.current = true;
      finishConnected(publicKey.toBase58());
    }
  }, [connected, publicKey, mode, currentPublicKey, finishConnected]);

  function beginConnect(found: Wallet) {
    pendingSelect.current = found.adapter.name as WalletName;
    select(found.adapter.name);
  }

  function startConnect(w: SupportedWallet) {
    setErr(null);
    setShowJupiterHint(false);
    const found = findSupportedAdapter(wallets, w);
    if (!found || found.readyState === WalletReadyState.Unsupported) {
      if (mobile && !insideWallet) {
        if (w.browseDeepLink) {
          window.location.href = w.browseDeepLink(currentPageUrl());
          return;
        }
        setShowJupiterHint(true);
        return;
      }
      window.open(w.download, '_blank', 'noopener,noreferrer');
      setErr(w.id === 'jupiter'
        ? 'Jupiter Wallet is not installed in this browser. Install the official extension from jup.ag/wallet, then reload this page, or open this URL in Jupiter Mobile’s dApp browser.'
        : `${w.name} is not installed in this browser. Install it, or open this page in the ${w.name} app.`);
      if (w.id === 'jupiter') setShowJupiterHint(true);
      return;
    }
    if (found.readyState === WalletReadyState.NotDetected && mobile && !insideWallet) {
      if (w.browseDeepLink) {
        window.location.href = w.browseDeepLink(currentPageUrl());
        return;
      }
      setShowJupiterHint(true);
      return;
    }
    beginConnect(found);
  }

  async function copyPageUrl() {
    const ok = await copyText(currentPageUrl());
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(false), 2000);
  }

  async function choosePaper() {
    setErr(null);
    if (mode === 'demo') { onPaper?.(); return; }
    if (mode === 'settings') { onPaper?.(); return; }
    setBusy(true);
    try {
      const r = await fetch('/api/onboarding/wallet', {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'paper' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? 'could not continue in paper mode');
      onPaper?.();
      window.location.href = j.next ?? '/app';
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  async function doDisconnect() {
    setErr(null); setBusy(true);
    try {
      try { await disconnect(); } catch { /* already disconnected */ }
      if (mode === 'demo') {
        try { sessionStorage.removeItem('cletus.demo.wallet'); } catch { /* ignore */ }
        onDisconnected?.();
        return;
      }
      const r = await fetch('/api/protected/wallet/disconnect', { method: 'POST', credentials: 'include' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && r.status !== 404) throw new Error(j.error ?? 'could not disconnect');
      onDisconnected?.();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  const shownKey = currentPublicKey || (connected && publicKey ? publicKey.toBase58() : null);
  const paper = !shownKey && (source === 'paper' || source === 'disconnected');
  const showMobileHint = mobile && !insideWallet;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
        <div className="font-semibold text-amber-300">{mode === 'owner' ? 'Owner login' : WALLET_CONNECT_COPY.headline}</div>
        <p className="text-sm text-zinc-300 mt-2 leading-relaxed">{mode === 'owner'
          ? 'Connect the Jupiter wallet you registered as the payout wallet and sign a message to prove you control it. This signature is not a transaction and does not give Cletus permission to move funds or to trade.'
          : WALLET_CONNECT_COPY.body}</p>
      </div>

      {shownKey && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
          <div className="text-xs uppercase tracking-wider text-emerald-400 font-semibold">Connected · you stay in control</div>
          <code className="block text-xs font-mono break-all text-white/80">{shownKey}</code>
          <p className="text-xs text-white/50">{WALLET_CONNECT_COPY.disconnect}</p>
          <button type="button" className="btn small" disabled={busy} onClick={doDisconnect}>Disconnect wallet</button>
        </div>
      )}

      {!shownKey && (
        <>
          <div>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-2">{mode === 'owner' ? 'Connect your owner wallet' : 'Connect a wallet (optional)'}</div>
            <div className="grid gap-2">
              {SUPPORTED_WALLETS.map((w) => {
                const found = findSupportedAdapter(wallets, w);
                const ready = found && found.readyState === WalletReadyState.Installed;
                const label = ready ? 'Detected' : showMobileHint ? (w.browseDeepLink ? 'Open app' : 'How to open') : 'Install / connect';
                return (
                  <button
                    key={w.id}
                    type="button"
                    disabled={busy || connecting}
                    onClick={() => startConnect(w)}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-left hover:border-amber-400/60 transition-colors disabled:opacity-50"
                    data-testid={`connect-${w.id}`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: w.color }} />
                      <span className="font-semibold">{w.name}</span>
                    </span>
                    <span className="text-xs text-white/40">{label}</span>
                  </button>
                );
              })}
            </div>

            {extras.length > 0 && (
              <div className="mt-4">
                <div className="text-xs uppercase tracking-wider text-white/40 mb-2">Select wallet</div>
                <div className="grid gap-2">
                  {extras.map((w) => {
                    const ready = w.readyState === WalletReadyState.Installed;
                    const name = w.adapter.name;
                    return (
                      <button
                        key={name}
                        type="button"
                        disabled={busy || connecting}
                        onClick={() => { setErr(null); beginConnect(w); }}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/40 px-4 py-3 text-left hover:border-amber-400/60 transition-colors disabled:opacity-50"
                        data-testid={`connect-standard-${name}`}
                      >
                        <span className="font-semibold">{name}</span>
                        <span className="text-xs text-white/40">{ready ? 'Detected' : 'Connect'}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {showMobileHint && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 mt-3 space-y-2" data-testid="mobile-wallet-hint">
                <div className="font-semibold text-sm">On a phone</div>
                <p className="text-xs text-white/60 leading-relaxed">
                  Phantom and Solflare buttons open this page inside those apps. Jupiter Mobile does not publish a verified browse deep link, so open this page in its in-app browser:
                </p>
                <ol className="text-xs text-white/70 list-decimal pl-4 space-y-1 leading-relaxed">
                  {JUPITER_MOBILE_STEPS.map((step) => <li key={step}>{step}</li>)}
                </ol>
                <button type="button" className="btn small" onClick={copyPageUrl} data-testid="copy-page-url">
                  {copied ? 'URL copied' : 'Copy page URL'}
                </button>
              </div>
            )}

            {(showJupiterHint && !showMobileHint) && (
              <div className="rounded-xl border border-white/10 bg-white/5 p-4 mt-3 space-y-2" data-testid="jupiter-install-hint">
                <p className="text-xs text-white/70 leading-relaxed">
                  Install the official Jupiter Wallet extension from jup.ag/wallet (Chrome Web Store, publisher extension@jup.ag). Then reload this page and tap Jupiter. On a phone, open this URL in Jupiter Mobile’s dApp browser (globe icon, top right).
                </p>
                <button type="button" className="btn small" onClick={copyPageUrl} data-testid="copy-page-url-desktop">
                  {copied ? 'URL copied' : 'Copy page URL'}
                </button>
              </div>
            )}
          </div>

          {mode !== 'owner' && (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="font-semibold">Just watch — paper mode</div>
            <p className="text-sm text-white/60 mt-1">{WALLET_CONNECT_COPY.paper}</p>
            <button type="button" className="btn primary" style={{ marginTop: 12 }} disabled={busy} onClick={choosePaper} data-testid="paper-mode">
              Continue without connecting
            </button>
          </div>
          )}
        </>
      )}

      {paper && shownKey === null && mode === 'settings' && (
        <p className="text-xs text-white/45">You are in paper mode. Connect a wallet above if you later want to approve live swaps yourself.</p>
      )}

      {err && <div className="err" role="alert">{err}</div>}
      {(busy || connecting) && <p className="muted text-xs">{connecting ? 'Waiting for your wallet…' : 'Working…'}</p>}
    </div>
  );
}
