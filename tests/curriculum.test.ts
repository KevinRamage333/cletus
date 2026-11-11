import { describe, it, expect } from 'vitest';
import { CURRICULUM_OVERVIEW, selectCurriculumNotes, CURRICULUM_TOPIC_IDS } from '@/lib/brain/curriculum';
import { SYSTEM_PROMPT, buildSystemInstruction } from '@/lib/brain/persona';

describe('curriculum overview', () => {
  it('is embedded in both the compact system prompt and lists every required area', () => {
    expect(SYSTEM_PROMPT).toContain(CURRICULUM_OVERVIEW);
    for (const h of [
      'CORE FOUNDATIONAL SUBJECTS',
      'Accounting & Financial Statements',
      'Economics',
      'Statistics & Mathematical Methods',
      'CORE FINANCE DISCIPLINES',
      'Corporate Finance',
      'Investments & Portfolio Management',
      'Financial Markets & Institutions',
      'Derivatives & Quantitative Finance',
      'Personal Finance & Planning',
      'SPECIALIZATIONS',
      'FinTech',
      'Risk Management',
      'Real Estate & Energy Finance',
      'ESG',
      'Tax Law (educational only)',
      'SOLANA DEFI & CRYPTO TRADING',
    ]) expect(CURRICULUM_OVERVIEW).toContain(h);
    expect(CURRICULUM_TOPIC_IDS).toEqual(expect.arrayContaining([
      'accounting', 'economics', 'statistics', 'corporate-finance', 'investments',
      'markets', 'derivatives', 'personal-finance', 'fintech', 'risk',
      'real-estate-energy', 'esg', 'tax',
    ]));
  });
});

describe('on-demand topic notes', () => {
  it('injects corporate-finance formulas for a DCF/WACC question and not unrelated treatises', () => {
    const n = selectCurriculumNotes('Walk me through a DCF and how WACC is built');
    expect(n).toMatch(/Corporate Finance/);
    expect(n).toMatch(/WACC = /);
    expect(n).toMatch(/NPV = /);
    expect(n).not.toMatch(/Form 1099-DA/);
  });
  it('injects Black-Scholes and the Greeks', () => {
    const n = selectCurriculumNotes('How do the Black-Scholes Greeks work?');
    expect(n).toMatch(/Black–Scholes/);
    expect(n).toMatch(/\*\*delta\*\*/);
    expect(n).toMatch(/\*\*vega\*\*/);
    expect(n).toMatch(/Itô's lemma|Ito's lemma/);
  });
  it('injects tax-year 2026 education for a Solana meme-coin tax question', () => {
    const n = selectCurriculumNotes('How are my Solana meme coin trades taxed?');
    expect(n).toMatch(/Tax Law/);
    expect(n).toMatch(/tax year 2026/i);
    expect(n).toMatch(/Notice 2014-21/);
    expect(n).toMatch(/1099-DA/);
    expect(n).toMatch(/Form 8949/);
    expect(n).toMatch(/§1091|wash-sale/i);
    expect(n).toMatch(/not tax advice/i);
    expect(n).toMatch(/Missouri/);
  });
  it('stays quiet on unrelated chit-chat and caps how many topics load', () => {
    expect(selectCurriculumNotes('what is your favorite movie?')).toBe('');
    expect(selectCurriculumNotes('')).toBe('');
    const n = selectCurriculumNotes('DCF WACC Black-Scholes Greeks VaR ESG cap rate tax 1099-DA');
    expect(n.match(/^#### /gm)?.length).toBeLessThanOrEqual(2);
  });
  it('is wired into the full persona when a query is supplied, and into empty builds otherwise', () => {
    expect(buildSystemInstruction({ snapshot: 's', briefing: null, journal: null })).not.toMatch(/Topic notes for this question/);
    const s = buildSystemInstruction({ snapshot: 's', briefing: null, journal: null, query: 'Explain the Black-Scholes Greeks' });
    expect(s).toMatch(/Topic notes for this question/);
    expect(s).toMatch(/\*\*delta\*\*/);
  });
});
