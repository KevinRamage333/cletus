import { describe, it, expect } from 'vitest';
import { demoGateDecision, gateDecision } from '@/lib/gate';
import {
  DISCLAIMER_PARAS,
  PHASES,
  WHITEPAPER_PDF_PATH,
  WHITEPAPER_VERSION,
  whitepaperPlainText,
} from '@/lib/whitepaper';
import { COMPANY_NAME, COMPANY_LEGAL } from '@/lib/company';

const text = whitepaperPlainText();
const lower = text.toLowerCase();

describe('whitepaper is a public document', () => {
  it('allows /whitepaper and the PDF in demo mode and for anonymous users', () => {
    expect(demoGateDecision('/whitepaper')).toEqual({ action: 'next' });
    expect(demoGateDecision('/whitepaper/')).toEqual({ action: 'next' });
    expect(demoGateDecision(WHITEPAPER_PDF_PATH)).toEqual({ action: 'next' });
    expect(gateDecision('/whitepaper', null, '2026-11-11.4')).toEqual({ action: 'next' });
    expect(gateDecision(WHITEPAPER_PDF_PATH, null, '2026-11-11.4')).toEqual({ action: 'next' });
  });
});

describe('whitepaper content rules', () => {
  it('names the company, is versioned, and has a full risk disclaimer', () => {
    expect(text).toContain(COMPANY_NAME);
    expect(text).toContain(COMPANY_LEGAL);
    expect(text).toContain(WHITEPAPER_VERSION);
    expect(DISCLAIMER_PARAS.length).toBeGreaterThanOrEqual(5);
    expect(lower).toMatch(/not financial.{0,40}advice/);
    expect(lower).toMatch(/not an offer/);
    expect(lower).toMatch(/losses?.{0,40}total loss|total loss of capital/);
    expect(lower).toMatch(/experimental/);
    expect(lower).toMatch(/not.{0,80}(registered|approved|licensed|compliant).{0,40}(sec|securities and exchange)/i);
  });

  it('does not promise profits, returns, or regulatory compliance', () => {
    // Negated uses ("no guaranteed gains", "not a guarantee of profit") are required disclosures.
    const unnegated = lower.replace(/\bno guaranteed\b[^.\n]{0,80}/g, ' ').replace(/\bnot (?:a |an )?guarantee(?:s|d)?\b[^.\n]{0,80}/g, ' ').replace(/\bguarantee of (?:nothing|no)\b[^.\n]{0,40}/g, ' ');
    expect(unnegated).not.toMatch(/guarantee(?:s|d)? (?:profits?|returns?|gains?|income)/);
    expect(lower).not.toMatch(/\d+(?:\.\d+)?\s?%\s*(?:a|per|each|every)?\s*(?:day|daily|week|weekly|month|monthly)/);
    expect(lower).not.toMatch(/risk[- ]free|sure[- ]fire|can't lose|cannot lose/);
    expect(lower).not.toMatch(/sec[- ](?:registered|licensed|approved|compliant)|fully compliant with the (?:sec|cftc)/);
    expect(lower).not.toMatch(/will make you money|guaranteed returns|expected profit/);
  });

  it('does not invent a token or tokenomics', () => {
    expect(lower).toMatch(/there is no cletus token|no cletus token|has no token/);
    expect(lower).toMatch(/no tokenomics/);
    expect(lower).not.toMatch(/\$cle|token ticker|token sale is live|airdrop allocation|vesting schedule|total supply of/);
  });

  it('describes the real system without fabricated performance stats', () => {
    for (const needle of [
      'Gemini',
      'Grok',
      'Helius',
      'RugCheck',
      'Jupiter',
      '0.5%',
      '50 basis points',
      'non-custodial',
      'Phantom',
      'stop-loss',
      'take-profit',
      'fast exit',
      'Degen',
      '$10,000 to $500,000',
      'Balanced',
      '$250,000 to $5,000,000',
      'Safer',
      '$5,000,000 to $50,000,000',
      'falling knife',
      'live trade view',
      'Public live P&L',
    ]) {
      expect(text).toContain(needle);
    }
    // No made-up APY / win-rate marketing numbers.
    expect(text).not.toMatch(/\b(?:APY|APR)\s*[=:]?\s*\d+/i);
    expect(text).not.toMatch(/win rate of \d+/i);
  });

  it('uses the owner roadmap order with phase gates and no dated promises', () => {
    expect(PHASES.map((p) => p.name)).toEqual([
      'Solana',
      'Base',
      'Ethereum',
      'Robinhood Chain and all other networks',
      'Stocks and forex',
    ]);
    expect(PHASES[0].status.toLowerCase()).toMatch(/live now.*beta/);
    expect(PHASES[1].gate.toLowerCase()).toMatch(/after solana is proven profitable/);
    expect(PHASES[4].body.toLowerCase()).toMatch(/licen[sc]/);
    expect(PHASES[4].body.toLowerCase()).toMatch(/broker/);
    expect(text.toLowerCase()).toMatch(/bnb smart chain|\bbsc\b/);
    expect(text).toMatch(/Arbitrum/);
    expect(text).not.toMatch(/Q[1-4]\s*20\d\d|by (?:January|February|March|April|May|June|July|August|September|October|December) 20\d\d/);
    expect(text.toLowerCase()).toMatch(/ha(?:s|ve) not shown a profitable edge/);
  });
});
