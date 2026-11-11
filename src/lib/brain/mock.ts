/**
 * Offline Brain (no GEMINI_API_KEY). Same persona, same read-only tools, deterministic answers.
 * Multi-turn aware: short follow-ups ("why?", "and now?") reuse the previous topic.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ToolRunner = (name: string, args?: Record<string, unknown>) => Promise<any>;

export type Intent =
  | 'execute' | 'kill' | 'pnl' | 'positions' | 'trades' | 'signals' | 'healing' | 'blocks' | 'config' | 'scan'
  | 'news' | 'journal' | 'doing' | 'rug' | 'solana' | 'econ' | 'accounting' | 'options' | 'strategy' | 'portfolio' | 'help';

const RULES: Array<[Intent, RegExp]> = [
  ['execute', /(^|\b(can|could|would|will) (you|u) |please )(buy|sell|ape( into)?|execute|place|open|close|go long|short)\b/],
  ['kill', /kill|emergency|halt|stop (all|trading)/],
  ['journal', /journal|reflect|lesson|learned today|diary/],
  ['news', /news|world|headline|macro|fed\b|fomc|briefing|happening|events?/],
  ['healing', /heal|priority fee|slippage|fail|congest|rpc/],
  ['blocks', /block|audit|reject|why (not|didn'?t)|skip/],
  ['doing', /what (are|r) (you|u) (doing|up to)|status|explain yourself|why did (you|u)/],
  ['signals', /signal|weight|learn|win rate|pattern/],
  ['positions', /position|holding|open|bag/],
  ['trades', /trade|history|closed|last (buy|sell)|recent/],
  ['pnl', /pnl|profit|loss|money|equity|balance|perform|how (am i|are we|is it) doing|up or down/],
  ['config', /config|preset|setting|parameter|aggress|stop.?loss|take.?profit|tier|sizing/],
  ['scan', /scan|candidate|watch|looking at|token(s)? (now|today)/],
  ['rug', /rug|scam|honeypot/],
  ['solana', /solana|\bsol\b/],
  ['econ', /gdp|inflation|interest rate|econom|recession|yield curve/],
  ['accounting', /p\/e|balance sheet|income statement|accounting|ebitda|dcf/],
  ['options', /option|\bcall\b|\bput\b|greek|delta|theta/],
  ['strategy', /porter|competitive|moat|business model/],
  ['portfolio', /portfolio|sharpe|capm|diversif/],
];

export function detectIntent(q: string, previous?: string | null): Intent {
  const t = q.toLowerCase();
  for (const [i, re] of RULES) if (re.test(t)) return i;
  if (previous && t.split(/\s+/).length <= 4 && /^(why|how|and|what about|more|explain|details?|go on|ok)/.test(t)) return detectIntent(previous);
  return 'help';
}

const usd = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const NFA = '\n\n_Not financial advice. Losses are possible; simulated results are not live results._';

export async function mockBrainAnswer(q: string, run: ToolRunner, history: Array<{ role: string; content: string }> = []): Promise<{ text: string; tools: string[]; intent: Intent }> {
  const prevUser = [...history].reverse().find((m) => m.role === 'user')?.content ?? null;
  const intent = detectIntent(q, prevUser);
  const tools: string[] = [];
  const call = async (n: string, a?: Record<string, unknown>) => { tools.push(n); return run(n, a); };
  const lead = prevUser && intent !== 'help' && detectIntent(prevUser) === intent ? `Picking up where we left off on "${prevUser.slice(0, 60)}" — ` : '';
  let text: string;

  switch (intent) {
    case 'execute':
      text = "I don't pull triggers from the chat — I'm **advisory only**. Every entry and exit is made by my deterministic signal engine after the security audit and compliance gate. You can **pause**, **resume**, or hit the **kill switch** from the dashboard. Ask me *why* I'm in or out of something and I'll walk you through the data.";
      break;
    case 'kill': {
      const s = await call('get_status');
      text = `The kill switch is **${s.killSwitch ? `ACTIVE (${s.killReason ?? 'manual'})` : 'off'}**. Hitting it halts scanning and closes every open position immediately; only an admin can release it. I can't press it for you from chat.`;
      break;
    }
    case 'pnl': case 'doing': {
      const s = await call('get_status');
      const a = s.account;
      text = `${lead}**Where I stand (${s.mode.toUpperCase()}, preset ${s.preset}, ${s.aggression}):**\n- Equity **${usd(a.equity)}** (cash ${usd(a.cash)}, started at ${usd(a.startingBalance)})\n- Realized **${usd(a.realizedPnl)}**, unrealized **${usd(a.unrealizedPnl)}**\n- Today ${usd(s.periodPnl.day)}, this week ${usd(s.periodPnl.week)}\n- ${s.trades.closed} closed trades${s.trades.winRate !== null ? `, win rate **${(s.trades.winRate * 100).toFixed(0)}%**` : ''}; ${s.trades.open} open\n- Sizing tier T${s.sizingTier.tier} (${s.sizingTier.multiplier}x)${a.recoveryMode ? ' — **recovery mode** (sizes reduced)' : ''}${a.paused ? ` — **paused**: ${a.pauseReason}` : ''}\n- Last scan: ${s.engine.lastScan}`;
      if (intent === 'doing') {
        const open = await call('get_positions');
        text += open.length ? `\n\n**Holding:** ${open.map((p: any) => `${p.symbol} ${usd(p.sizeUsd)} (${p.unrealizedPnlPct >= 0 ? '+' : ''}${p.unrealizedPnlPct}%)`).join(', ')}.` : '\n\nNo open positions — waiting for a token that clears the score gate, audit, and compliance checks.';
      }
      text += NFA;
      break;
    }
    case 'positions': {
      const open = await call('get_positions');
      text = open.length
        ? `**Open positions:**\n\n| Token | Size | Entry | Last | PnL | Score |\n|---|---|---|---|---|---|\n${open.map((p: any) => `| ${p.symbol} | ${usd(p.sizeUsd)} | ${p.entryPrice.toPrecision(4)} | ${p.lastPrice.toPrecision(4)} | ${p.unrealizedPnlPct >= 0 ? '+' : ''}${p.unrealizedPnlPct}% | ${p.compositeScore} |`).join('\n')}${NFA}`
        : 'No open positions right now.';
      break;
    }
    case 'trades': {
      const t = await call('get_recent_trades', { limit: 8 });
      text = t.length
        ? `**Recent closed trades:**\n${t.map((x: any) => `- **${x.symbol}** ${x.pnlUsd >= 0 ? '+' : ''}${usd(x.pnlUsd)} (${x.pnlPct}%) — exit: ${x.exitReason}, entry score ${x.compositeScore}`).join('\n')}${NFA}`
        : 'No closed trades yet.';
      break;
    }
    case 'signals': {
      const w = await call('get_signal_weights');
      text = `${lead}**My 8 signals and what I've learned:**\n\n| Signal | Weight | Start | Win rate |\n|---|---|---|---|\n${w.map((x: any) => `| ${x.signal} | ${(x.weight * 100).toFixed(1)}% | ${(x.initialWeight * 100).toFixed(1)}% | ${x.winRate === null ? '—' : `${(x.winRate * 100).toFixed(0)}% (${x.wins}/${x.trials})`} |`).join('\n')}\n\nAfter each closed trade, signals that were active at entry get amplified on wins and dampened on losses, then re-normalised. Rules from my spec: **volume spike** = 5m volume > 5% of market cap; **breakout** = > 5% price rise in 5m; **buy pressure** = buys > 70% of 5m txns.`;
      break;
    }
    case 'healing': {
      const h = await call('get_self_healing');
      text = `**Self-healing state:** priority fee **${h.priorityFeeLamports.toLocaleString()}** lamports (base ${h.limits.basePriorityFee.toLocaleString()}, max ${h.limits.maxPriorityFee.toLocaleString()}), slippage **${h.slippageBps} bps** (base ${h.limits.baseSlippageBps}, max ${h.limits.maxSlippageBps}), consecutive failures **${h.consecutiveFailures}/${h.limits.maxConsecutiveFailures}**${h.pausedUntil && new Date(h.pausedUntil) > new Date() ? `, **paused until ${new Date(h.pausedUntil).toISOString()}**` : ''}.${h.lastError ? `\nLast error: ${h.lastError}` : ''}\n\nOn failures I raise the fee x${h.limits.escalation}, widen slippage +${h.limits.widenStepBps} bps, and pause for ${h.limits.pauseMinutes} min after ${h.limits.maxConsecutiveFailures} in a row. Successes decay both back toward base.`;
      break;
    }
    case 'blocks': {
      const b = await call('get_blocks', { limit: 8 });
      text = b.length ? `**Recent blocks (why I passed):**\n${b.map((x: any) => `- ${x.message}`).join('\n')}` : 'No audit or compliance blocks recorded recently.';
      break;
    }
    case 'config': {
      const c = await call('get_config');
      text = `**Active config:** ${c.mode.toUpperCase()}, preset **${c.preset}**, aggression **${c.aggression}**.\n- Entry: score ≥ ${c.entry.minCompositeScore}, mcap $${c.entry.marketCapBand[0].toLocaleString()}–$${c.entry.marketCapBand[1].toLocaleString()}, max ${c.entry.maxOpenPositions} positions, max ${usd(c.entry.maxPositionSizeUsd)}\n- Exits: SL ${c.exits.stopLossPct}%, TP ${c.exits.takeProfitPct}%, break-even at +${c.exits.breakEvenTriggerPct}%, trailing ${c.exits.trailing}${typeof c.exits.trailing === 'number' ? '%' : ''}, max hold ${c.exits.holdTimeMinutes}m\n- Risk: ${c.risk.riskPerTradePct}% per trade, ${c.risk.maxTotalExposurePct}% max exposure, ${c.risk.maxDrawdownPct}% max drawdown, daily loss limit ${usd(c.risk.dailyLossLimit)}\n- Compliance: ≤${c.compliance.maxVolumeShare * 100}% of 24h volume, ≤${c.compliance.maxLiquidityShare * 100}% of liquidity, ${c.compliance.washTradeWindowMin}m wash window, ${c.compliance.maxTradesPer5Min} trades / 5m`;
      break;
    }
    case 'scan': {
      const s = await call('get_scan_candidates', { limit: 8 });
      text = s.length ? `**Top of my latest scan (ranked by volume/mcap):**\n${s.map((x: any) => `- **${x.symbol}** mcap $${Math.round(x.marketCap / 1000)}k, vol/mcap ${x.volMcap}x, score ${x.composite}${x.rejected ? ` — skipped: ${x.rejected}` : x.audit ? (x.audit.passed ? ' — audit passed' : ` — audit failed: ${x.audit.failed.join(', ')}`) : ''}`).join('\n')}${NFA}` : 'No scan results yet — give me a minute.';
      break;
    }
    case 'news': {
      const b = await call('get_world_briefing');
      text = b.briefing ? `**World briefing** (${b.briefingSource}, ${b.briefingAt ? new Date(b.briefingAt).toISOString() : ''}):\n\n${b.briefing}` : 'No world briefing yet — the news module runs on a schedule.';
      if (b.solPriceUsd) text += `\n\nSOL: **$${b.solPriceUsd.toFixed(2)}**${b.solChange24h !== null ? ` (${b.solChange24h >= 0 ? '+' : ''}${b.solChange24h.toFixed(2)}% 24h)` : ''}.`;
      break;
    }
    case 'journal': {
      const j = await call('get_journal', { limit: 3 });
      text = j.length ? `**From my journal:**\n\n${j.map((x: any) => `### ${x.title}\n${x.content}`).join('\n\n')}` : "My journal is empty — I write an entry after every closed trade and once a day.";
      break;
    }
    case 'rug':
      text = '**Rug Detection Checklist** (what my audit runs before every entry):\n- Mint authority renounced\n- Freeze authority renounced\n- LP locked/burned\n- A Jupiter sell route exists at sane price impact (honeypot check)\n- Largest non-pool holder under the concentration limit\n- RugCheck score under the max risk score\n\nThese are heuristics — they reduce risk, they do not remove it.';
      break;
    case 'solana':
      text = '**Solana DeFi Quick Overview:**\n- High throughput, sub-cent fees\n- Main venues: Raydium, Orca, Meteora, Pump.fun/PumpSwap; Jupiter aggregates routes\n- Key metrics: DexScreener / Birdeye\n\nWhat specifically about Solana would you like to know?';
      break;
    case 'econ':
      text = '**Economics Fundamentals:**\n\n**GDP** = C + I + G + (X – M).\n\n**Inflation** is measured by CPI and PCE; the Fed targets ~2%. When inflation runs hot, the Fed raises rates to cool spending and borrowing.\n\n**Fed tools:** fed funds rate, open market operations, reserve requirements, QE/QT.\n\n**Yield curve:** an inverted curve has historically preceded recessions by 12–18 months.';
      break;
    case 'accounting':
      text = '**Key Accounting & Valuation Concepts:**\n\n| Metric | Formula | Meaning |\n|---|---|---|\n| P/E | Price / EPS | Price per $1 of earnings |\n| EV/EBITDA | EV / EBITDA | Whole-company valuation |\n| ROE | Net Income / Equity | Return on shareholder funds |\n| Debt/Equity | Debt / Equity | Leverage |\n\n**DCF:** sum of discounted future cash flows at WACC; very sensitive to terminal growth.';
      break;
    case 'options':
      text = '**Options Essentials:**\n- Call = right to buy at strike; Put = right to sell at strike\n\n| Greek | Measures |\n|---|---|\n| Delta | Price sensitivity |\n| Gamma | Change of delta |\n| Theta | Time decay |\n| Vega | Implied-vol sensitivity |\n| Rho | Rate sensitivity |\n\nCommon strategies: covered call, protective put, spreads, iron condor, straddle.';
      break;
    case 'strategy':
      text = "**Business Strategy:** Porter's Five Forces — new entrants, supplier power, buyer power, substitutes, rivalry. Moats: network effects, cost advantages, switching costs, intangibles, efficient scale. Blue Ocean: create uncontested market space.";
      break;
    case 'portfolio':
      text = '**Portfolio Theory:** diversification cuts unsystematic risk; the efficient frontier maximises return per unit of risk. **CAPM:** E[R] = Rf + β(Rm − Rf). **Sharpe** = (R − Rf)/σ; > 1 is good, > 2 excellent.';
      break;
    default:
      text = "I'm **Cletus** — economics, accounting, business strategy, markets, options, and Solana DeFi are my turf, and I can see my own live state.\n\n**Ask me:**\n- *What are you doing right now and why?*\n- *How's PnL? Which signals are winning?*\n- *Why didn't you buy that token?* (audit / compliance blocks)\n- *What's happening in the world today?*\n- *What did you learn from your last trade?*\n\n_(Offline mode — set GEMINI_API_KEY for full reasoning.)_";
  }
  return { text, tools, intent };
}
