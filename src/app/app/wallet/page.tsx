'use client';

/**
 * Page 3 — Cletus Wallet
 * After Tax Center registration. Black background, logo on every page.
 * Shows managed Cletus wallet, 30-day trial countdown, fund instructions.
 * Route: /app/wallet
 */

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

type WalletState = {
  address: string | null;
  mode: 'managed' | 'external' | null;
  solBalance: number;
  usdcBalance: number;
  trialStartedAt: string | null;
  trialDays: number;
  trialActive: boolean;
  daysRemaining: number;
};

const TRIAL_DAYS_DEFAULT = 30;

function daysLeft(trialStartedAt: string | null, trialDays: number): number {
  if (!trialStartedAt) return trialDays;
  const start = new Date(trialStartedAt).getTime();
  const end = start + trialDays * 24 * 60 * 60 * 1000;
  const left = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, left);
}

export default function CletusWalletPage() {
  const [wallet, setWallet] = useState<WalletState>({
    address: null,
    mode: 'external',
    solBalance: 0,
    usdcBalance: 0,
    trialStartedAt: new Date().toISOString(),
    trialDays: TRIAL_DAYS_DEFAULT,
    trialActive: true,
    daysRemaining: TRIAL_DAYS_DEFAULT,
  });
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Wire to Golden1: GET /api/protected/wallet/status
    async function load() {
      try {
        const res = await fetch('/api/protected/wallet/status', {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          const trialStartedAt = data.trialStartedAt ?? new Date().toISOString();
          const trialDays = data.trialDays ?? TRIAL_DAYS_DEFAULT;
          const remaining = daysLeft(trialStartedAt, trialDays);
          setWallet({
            address: data.managedWalletId ?? data.address ?? null,
            mode: data.mode ?? 'external',
            solBalance: data.solBalance ?? 0,
            usdcBalance: data.usdcBalance ?? 0,
            trialStartedAt,
            trialDays,
            trialActive: remaining > 0,
            daysRemaining: remaining,
          });
        } else {
          // Demo placeholder until backend is live
          setWallet((prev) => ({
            ...prev,
            address: prev.address,
            daysRemaining: daysLeft(prev.trialStartedAt, prev.trialDays),
          }));
        }
      } catch {
        setWallet((prev) => ({
          ...prev,
          address: prev.address,
          daysRemaining: daysLeft(prev.trialStartedAt, prev.trialDays),
        }));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const copyAddress = async () => {
    if (!wallet.address) return;
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const shortAddress = (addr: string | null) => {
    if (!addr) return '—';
    if (addr.length < 12) return addr;
    return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      {/* Logo on every page */}
      <header className="border-b border-white/10 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          <Link href="/app" className="flex items-center gap-3">
            <Image
              src="/cletus-logo.png"
              alt="Cletus"
              width={40}
              height={40}
              className="object-contain"
              priority
            />
            <div>
              <div className="font-bold text-lg tracking-tight leading-none">Cletus</div>
              <div className="text-xs text-white/50 mt-0.5">Your wallet</div>
            </div>
          </Link>
          <nav className="flex items-center gap-3 text-xs">
            <Link href="/app/signals" className="text-white/50 hover:text-white transition-colors">
              Signals
            </Link>
            <Link href="/tax" className="text-white/50 hover:text-white transition-colors">
              Tax Center
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-2xl space-y-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold tracking-tight">Cletus Wallet</h1>
            <p className="text-sm text-white/50 mt-1">
              Your browser wallet (created or imported during onboarding). Cletus only ever sees the public address.
            </p>
          </div>

          {/* Trial status */}
          <div
            className={`rounded-xl border p-5 ${
              wallet.trialActive
                ? 'border-emerald-500/50 bg-emerald-500/10'
                : 'border-yellow-500/40 bg-yellow-500/10'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
                  Free trial
                </div>
                <div className="text-lg font-bold mt-0.5">
                  {wallet.trialActive ? (
                    <span className="text-emerald-400">
                      {wallet.daysRemaining} day{wallet.daysRemaining !== 1 ? 's' : ''} left
                    </span>
                  ) : (
                    <span className="text-yellow-400">Trial ended</span>
                  )}
                </div>
                <p className="text-xs text-white/50 mt-1">
                  {wallet.trialActive
                    ? '30-day beta trial · paper trading · no payment'
                    : 'Trial period ended. The beta is still free; there is no billing.'}
                </p>
              </div>
              <div className="text-3xl">{wallet.trialActive ? '🎁' : '⏳'}</div>
            </div>
            {wallet.trialActive && (
              <div className="mt-4 h-2 rounded-full bg-black/40 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{
                    width: `${Math.min(
                      100,
                      (wallet.daysRemaining / (wallet.trialDays || TRIAL_DAYS_DEFAULT)) * 100
                    )}%`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Wallet card */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wider text-white/50">
                Your wallet · live on-chain balances
              </div>
              {loading && (
                <span className="text-xs text-white/30 font-mono">Loading…</span>
              )}
            </div>

            <div>
              <div className="text-xs text-white/40 mb-1.5">Address</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-sm font-mono text-white break-all bg-black/50 rounded-lg px-3 py-2.5 border border-white/10">
                  {wallet.address ?? 'Creating…'}
                </code>
                <button
                  type="button"
                  onClick={copyAddress}
                  disabled={!wallet.address}
                  className="shrink-0 px-3 py-2.5 rounded-lg text-xs font-medium border border-white/15 text-white/70 hover:text-white hover:border-white/30 disabled:opacity-40 transition-all"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-white/30 mt-1.5">
                Short: {shortAddress(wallet.address)}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-white/10 bg-black/40 p-4">
                <div className="text-xs text-white/40 uppercase tracking-wider">SOL</div>
                <div className="text-xl font-bold font-mono mt-1">
                  {wallet.solBalance.toFixed(4)}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/40 p-4">
                <div className="text-xs text-white/40 uppercase tracking-wider">USDC</div>
                <div className="text-xl font-bold font-mono mt-1">
                  {wallet.usdcBalance.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Fund instructions */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-3">
            <h2 className="text-sm font-semibold">Do not fund this wallet for the beta</h2>
            <ol className="text-sm text-white/70 space-y-2 list-decimal list-inside">
              <li>Beta trading is <strong className="text-white">paper only</strong>: simulated fills on live market data. This wallet is not used to trade.</li>
              <li>Your secret key / recovery phrase stays encrypted in this browser and never reaches the server.</li>
              <li>Balances above are read live from Solana via Helius, for your information.</li>
            </ol>
            <p className="text-xs text-white/40">
              Never share seed phrases. Cletus never asks for your private keys in chat or
              email.
            </p>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Link
              href="/app/signals"
              className="flex-1 py-3.5 rounded-xl text-sm font-semibold text-center bg-white text-black hover:bg-white/90 transition-all"
            >
              View USDC Signals
            </Link>
            <Link
              href="/app"
              className="flex-1 py-3.5 rounded-xl text-sm font-medium text-center border border-white/20 text-white/80 hover:bg-white/5 transition-all"
            >
              App home
            </Link>
          </div>

          <p className="text-center text-xs text-white/30">
            Educational software only. Trading involves risk of loss. Not financial advice.
          </p>
        </div>
      </main>
    </div>
  );
}
