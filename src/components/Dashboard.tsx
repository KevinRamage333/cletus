'use client';
import { useCallback, useEffect, useState } from 'react';
import BrainChat from './BrainChat';
import NewsPanel from './NewsPanel';
import JournalPanel from './JournalPanel';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Status = any;

const usd = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`);
const cls = (n: number | null | undefined) => (n === null || n === undefined ? '' : n > 0 ? 'green' : n < 0 ? 'red' : '');
const ago = (d: string | null) => { if (!d) return '—'; const s = Math.round((Date.now() - new Date(d).getTime()) / 1000); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const tm = (d: string) => new Date(d).toLocaleTimeString();

export default function Dashboard() {
  const [s, setS] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<'me' | 'operator'>('me');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/status${view === 'operator' ? '?account=operator' : ''}`, { cache: 'no-store' });
      if (r.status === 401 || r.status === 403) { window.location.href = '/signup'; return; }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? 'failed');
      setS(j); setErr(null);
    } catch (e) { setErr((e as Error).message); }
  }, [view]);

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  async function post(url: string, body: object, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(true);
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, account: view === 'operator' ? 'operator' : undefined }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) alert(j.error ?? 'failed');
    load();
  }

  if (!s) return <div className="center-page">{err ? <span className="err">{err}</span> : 'Loading Cletus…'}</div>;
  const a = s.account, e = s.engine, c = s.config;
  const totalPnl = a.realizedPnl + a.unrealizedPnl;

  return (
    <div className="dash">
      <div className="topbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0 }}>Cletus</h1>
          <span className={`badge ${c.mode === 'live' ? 'live' : 'sim'}`}>{c.mode === 'live' ? 'LIVE TRADING' : 'SIMULATION · PAPER'}</span>
          {c.betaMode && <span className="badge warn">BETA</span>}
          <span className="badge">{c.preset === 'NONE' ? 'no preset' : c.preset}</span>
          <span className="badge">{c.aggression}</span>
          <span className={`badge ${e.withinSchedule ? 'ok' : 'warn'}`}>{e.withinSchedule ? 'in schedule' : 'outside schedule'}</span>
          {e.killSwitch && <span className="badge live">KILL SWITCH ON</span>}
          {a.paused && <span className="badge warn">PAUSED</span>}
          {a.recoveryMode && <span className="badge warn">RECOVERY MODE</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {s.user.isAdmin && (
            <select value={view} onChange={(ev) => setView(ev.target.value as 'me' | 'operator')} style={{ width: 'auto' }}>
              <option value="me">My paper account</option>
              <option value="operator">Operator account</option>
            </select>
          )}
          {s.user.isAdmin && <button className="btn small" disabled={busy} onClick={() => post('/api/engine/scan', {})}>Scan now</button>}
          {a.paused ? <button className="btn small" onClick={() => post('/api/account', { action: 'resume' })}>Resume</button> : <button className="btn small" onClick={() => post('/api/account', { action: 'pause' })}>Pause</button>}
          <a className="btn small" href="/brain">Talk to Cletus</a>
          <a className="btn small" href="/feedback">Feedback / Bug</a>
          <a className="btn small" href="/api/auth/logout">Sign out</a>
          {e.killSwitch
            ? <button className="btn danger" disabled={busy || !s.user.isAdmin} onClick={() => post('/api/kill-switch', { active: false }, 'Release the kill switch and resume trading?')}>Release Kill Switch</button>
            : <button className="btn danger" disabled={busy} onClick={() => post('/api/kill-switch', { active: true }, 'KILL SWITCH: halt all scanning and close every open position now?')}>⛔ Kill Switch</button>}
        </div>
      </div>

      <div className="disclaimer-bar">Not financial advice. No guaranteed gains — losses, including total loss, can occur. {c.mode !== 'live' ? 'Simulation: real DexScreener market data, paper fills, no transactions are signed.' : 'LIVE: real funds at risk.'}</div>

      <div className="stats">
        <div className="card stat"><div className="muted">Equity ({a.isOperator ? 'operator' : 'paper'})</div><div className="v">{usd(a.equity)}</div><div className="muted">start {usd(a.startingBalance, 0)}</div></div>
        <div className="card stat"><div className="muted">Total PnL</div><div className={`v ${cls(totalPnl)}`}>{usd(totalPnl)}</div><div className="muted">realized <span className={cls(a.realizedPnl)}>{usd(a.realizedPnl)}</span> · open <span className={cls(a.unrealizedPnl)}>{usd(a.unrealizedPnl)}</span></div></div>
        <div className="card stat"><div className="muted">Today / Week</div><div className={`v ${cls(a.pnl.day)}`}>{usd(a.pnl.day)}</div><div className="muted">week <span className={cls(a.pnl.week)}>{usd(a.pnl.week)}</span></div></div>
        <div className="card stat"><div className="muted">Trades / Win rate</div><div className="v">{a.closedTrades} · {a.winRate === null ? '—' : `${(a.winRate * 100).toFixed(0)}%`}</div><div className="muted">{s.open.length} open / max {c.maxOpenPositions}</div></div>
        <div className="card stat"><div className="muted">Sizing tier</div><div className="v">T{a.tier} · {a.tierMultiplier}x</div><div className="muted">exposure {usd(a.exposure, 0)}</div></div>
        <div className="card stat"><div className="muted">Engine</div><div className="v" style={{ fontSize: 15 }}>{e.scanCount} scans · {ago(e.lastScanAt)}</div><div className="muted">fee {e.priorityFeeLamports.toLocaleString()} lamports · slip {e.slippageBps}bps · fails {e.consecutiveFailures}</div></div>
      </div>

      <div className="cols">
        <div className="grid">
          <div className="card">
            <h2>Open positions</h2>
            <div className="scroll">
              <table>
                <thead><tr><th>Token</th><th>Size</th><th>Entry</th><th>Last</th><th>PnL</th><th>Score</th><th>Opened</th><th></th></tr></thead>
                <tbody>
                  {s.open.length === 0 && <tr><td colSpan={8} className="muted">No open positions</td></tr>}
                  {s.open.map((p: any) => (
                    <tr key={p.id}><td><b>{p.symbol}</b> {!p.simulated && <span className="badge live">LIVE</span>}</td><td>{usd(p.sizeUsd)}</td><td className="mono">{p.entryPrice.toPrecision(4)}</td><td className="mono">{p.lastPrice.toPrecision(4)}</td>
                      <td className={cls(p.pnlUsd)}>{usd(p.pnlUsd)} ({pct(p.pnlPct)})</td><td>{p.compositeScore.toFixed(2)}</td><td>{ago(p.openedAt)}</td>
                      <td><a href={`https://dexscreener.com/solana/${p.mint}`} target="_blank" rel="noreferrer">chart</a></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Closed trades</h2>
            <div className="scroll">
              <table>
                <thead><tr><th>Token</th><th>Size</th><th>Entry</th><th>Exit</th><th>PnL</th><th>Reason</th><th>Closed</th></tr></thead>
                <tbody>
                  {s.closed.length === 0 && <tr><td colSpan={7} className="muted">No closed trades yet</td></tr>}
                  {s.closed.map((p: any) => (
                    <tr key={p.id}><td><b>{p.symbol}</b></td><td>{usd(p.sizeUsd)}</td><td className="mono">{p.entryPrice.toPrecision(4)}</td><td className="mono">{p.exitPrice?.toPrecision(4)}</td>
                      <td className={cls(p.pnlUsd)}>{usd(p.pnlUsd)} ({pct(p.pnlPct)})</td><td>{p.exitReason}</td><td>{p.closedAt ? tm(p.closedAt) : ''}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2>Scanner — ${c.minMarketCap / 1000}k–${c.maxMarketCap / 1000}k mcap, ranked by volume / market cap</h2>
            <div className="muted" style={{ marginBottom: 6 }}>{e.lastScanSummary}</div>
            <div className="scroll">
              <table>
                <thead><tr><th>Token</th><th>MCap</th><th>Vol 24h</th><th>Vol/MCap</th><th>1h</th><th>Score</th><th>Status</th></tr></thead>
                <tbody>
                  {s.candidates.length === 0 && <tr><td colSpan={7} className="muted">Waiting for first scan…</td></tr>}
                  {s.candidates.map((x: any) => (
                    <tr key={x.mint}><td><a href={x.url ?? `https://dexscreener.com/solana/${x.mint}`} target="_blank" rel="noreferrer">{x.symbol}</a></td><td>{usd(x.marketCap, 0)}</td><td>{usd(x.volume24h, 0)}</td><td>{x.volMcap.toFixed(2)}x</td>
                      <td className={cls(x.priceChangeH1)}>{pct(x.priceChangeH1)}</td><td><b className={x.composite >= c.minCompositeScore ? 'green' : ''}>{x.composite.toFixed(3)}</b></td>
                      <td className="muted" style={{ whiteSpace: 'normal', maxWidth: 320 }}>{x.rejected ? x.rejected : x.audit ? (x.audit.passed ? <span className="green">audit passed</span> : <span className="red" title={x.audit.failed.join('\n')}>audit failed: {x.audit.failed[0]}</span>) : x.composite >= c.minCompositeScore ? 'qualified' : `below ${c.minCompositeScore}`}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="grid">
          <div className="card">
            <h2>Brain</h2>
            <BrainChat account={view === 'operator' ? 'operator' : undefined} />
            <div className="muted" style={{ fontSize: 11 }}>{c.hasGeminiKey ? `Gemini model: ${c.geminiModel} · Google Search grounding` : 'No GEMINI_API_KEY, so answers come offline from live data'}</div>
          </div>
          <NewsPanel isAdmin={s.user.isAdmin} />
          <JournalPanel account={view === 'operator' ? 'operator' : undefined} />
          <div className="card">
            <h2>Signal weights (self-learning)</h2>
            {s.weights.sort((x: any, y: any) => y.weight - x.weight).map((w: any) => (
              <div key={w.name} style={{ marginBottom: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{w.name}</span><span className="muted">{(w.weight * 100).toFixed(1)}% · {w.trials ? `${w.wins}/${w.trials} wins` : 'no trials'}</span></div>
                <div className="bar"><i style={{ width: `${Math.min(100, w.weight * 400)}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Logs</h2>
            <div className="logs mono">
              {s.logs.map((l: any) => (
                <div key={l.id}><span className="muted">{tm(l.at)}</span> <span className={l.level === 'error' ? 'red' : l.level === 'warn' ? 'amber' : l.level === 'trade' ? 'green' : ''}>{l.level.toUpperCase()}</span> {l.message}</div>
              ))}
            </div>
          </div>
          <div className="card">
            <h2>Wallets</h2>
            <div className="muted">Your browser wallet (public key only):</div>
            <div className="mono" style={{ wordBreak: 'break-all' }}>{s.user.walletPublicKey ?? '—'}</div>
            {s.user.isAdmin && (<><div className="muted" style={{ marginTop: 8 }}>Operator trading wallet (server):</div><div className="mono" style={{ wordBreak: 'break-all' }}>{s.operatorWallet ?? 'not configured'}</div></>)}
            <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>SL {c.stopLossPct}% · TP {c.takeProfitPct}% · trail {c.enableTrailingStop ? `${c.trailingStopPct}%` : 'off'} · hold {c.holdTimeMinutes}m · min score {c.minCompositeScore} · max pos {usd(c.maxPositionSizeUsd, 0)}</div>
            {e.lastError && <div className="amber" style={{ fontSize: 12, marginTop: 6 }}>last error: {e.lastError}</div>}
            {c.liveBlockedReason && <div className="amber" style={{ fontSize: 12, marginTop: 6 }}>live blocked: {c.liveBlockedReason}</div>}
            <div style={{ marginTop: 10 }}><button className="btn small" onClick={() => post('/api/account', { action: 'reset' }, 'Reset this paper account to its starting balance and delete its trade history?')}>Reset paper account</button></div>
          </div>
        </div>
      </div>
    </div>
  );
}
