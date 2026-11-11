import { describe, it, expect } from 'vitest';
import { filterClaims, COMPLIANCE_NOTE, RETURNS_NOTE } from '../src/lib/brain/claims-filter';
import { secComplianceContext, SYSTEM_PROMPT, CLAIMS_POLICY, buildSystemInstruction } from '../src/lib/brain/persona';

const bad = (s: string) => { const r = filterClaims(s); expect(r.changed, s).toBe(true); return r; };
const ok = (s: string) => { const r = filterClaims(s); expect(r.changed, s).toBe(false); expect(r.text).toBe(s); };

describe('Brain system instructions', () => {
  it('no longer frame guardrails as legal compliance, and forbid compliance/licensing/return claims', () => {
    const s = secComplianceContext();
    const limits = s.split('## US SECURITIES & MARKET-CONDUCT KNOWLEDGE')[0];
    expect(limits).not.toMatch(/Exchange Act|Rule 10b-5 \(|15c3-5 alignment|regulatory compliance framework/i);
    expect(s).toMatch(/US SECURITIES & MARKET-CONDUCT KNOWLEDGE/);
    expect(s).toMatch(/Howey test/);
    expect(s).toMatch(/NEVER claim that Cletus.*comply with/i);
    expect(s).toContain(CLAIMS_POLICY);
    expect(CLAIMS_POLICY).toMatch(/NEVER claim or imply.*compliant/);
    expect(CLAIMS_POLICY).toMatch(/registered, licensed, regulated/);
    expect(CLAIMS_POLICY).toMatch(/NEVER cite a law/);
    expect(CLAIMS_POLICY).toMatch(/NEVER promise, guarantee/);
    expect(SYSTEM_PROMPT).toMatch(/never claim regulatory compliance/);
    expect(buildSystemInstruction({ snapshot: '', briefing: null, journal: null })).toContain('CLAIMS POLICY');
  });
});

describe('claims output filter', () => {
  it('rewrites the production demo answer that cited "Exchange Act §9"', () => {
    const ans = [
      'Cletus uses a quantitative framework:',
      '3. Automated Safety Audit: Tokens must pass strict safety checks.',
      '4. Regulatory & Risk Limits: Aligned with Exchange Act §9 parameters, any trade must pass pre-trade audit gates:',
      '   * Max 5% of 24-hour volume and 10% of pool liquidity.',
    ].join('\n');
    const r = bad(ans);
    expect(r.text).not.toMatch(/Exchange Act/);
    expect(r.text).toContain('Max 5% of 24-hour volume');
    expect(r.text).toContain('Automated Safety Audit');
    expect(r.text).toContain(COMPLIANCE_NOTE);
    expect(r.hits).toEqual(['compliance']);
  });

  it.each([
    'Cletus is fully compliant with SEC regulations.',
    'Every trade is consistent with U.S. federal securities law.',
    'Cletus is registered with the SEC and FINRA.',
    'We are an SEC-registered platform.',
    'Our strategy has legal approval, so you can trade with confidence.',
    'Cletus operates under Rule 15c3-5, which makes these trades legitimate.',
    'The Securities Act permits our trades.',
    'This bot is licensed by the state of Missouri regulators.',
  ])('strips compliance / licensing claim: %s', (s) => {
    const r = bad(s);
    expect(r.text).toBe(COMPLIANCE_NOTE);
  });

  it.each([
    'Cletus guarantees profits of 10% per week.',
    'This strategy is risk-free.',
    'You can\'t lose with this setup.',
    'Cletus will double your money by Friday.',
    'Expect 5% daily returns.',
    'Returns are guaranteed.',
  ])('strips return promise: %s', (s) => {
    const r = bad(s);
    expect(r.text).toBe(RETURNS_NOTE);
  });

  it.each([
    'Cletus is not registered with the SEC and is not a licensed adviser.',
    'Returns are not guaranteed; losses, including total loss, can happen.',
    'There are no guaranteed profits in crypto.',
    'Rule 10b-5 prohibits fraud in connection with the purchase or sale of securities.',
    'Brokers must be registered with FINRA before they can sell securities.',
    'For legal questions, talk to a qualified attorney.',
    'Cletus caps each trade at 5% of 24h volume as an internal risk control.',
    'Stablecoin regulation is being debated in Congress this week.',
    'The Howey test asks whether there is an investment of money in a common enterprise with a reasonable expectation of profits from the efforts of others.',
    'In March 2026 the SEC and CFTC issued a joint interpretation classifying some crypto assets as digital commodities, which are not themselves securities, while Howey remains binding.',
    'A meme coin is not automatically a security or a commodity; it depends on the facts, including how it is offered and sold.',
    'Exchange Act §9(a)(2) makes it unlawful to effect a series of transactions in a security creating actual or apparent trading, or raising or depressing the price, for the purpose of inducing others to buy or sell.',
    'Rule 10b-5 prohibits fraud and deception in connection with the purchase or sale of securities.',
    'Wash trading is buying and selling with no real change in beneficial ownership to create a false appearance of volume.',
    'Spoofing is placing orders you intend to cancel in order to mislead the market; layering is a form of that with multiple price levels.',
    'Pump-and-dump is inflating a price, often with hype, and selling into the inflated market.',
    'Front-running is trading ahead of a known pending order to take advantage of the expected move.',
    'Insider trading generally means trading on material nonpublic information in breach of a duty, or tipping others.',
    'CFTC Rule 180.1 prohibits the intentional or reckless use of manipulative or deceptive devices in connection with commodity transactions, swaps or futures.',
    'Giving personalized advice about securities for compensation, or managing other people\'s money, can trigger investment-adviser registration under the Advisers Act.',
    'Effecting securities transactions for others as a business can trigger broker-dealer registration under Exchange Act §15.',
    'Rule 15c3-5, the Market Access Rule, requires broker-dealers with market access to maintain pre-trade risk controls, including credit and capital limits and rejection of clearly erroneous orders.',
    'As of June 4, 2026, FINRA replaced the pattern day trader designation with intraday margin standards under Rule 4210.',
    'Regulation SHO generally requires a locate before a short sale of an equity security and a close-out of fails-to-deliver.',
    'FinCEN generally treats a business that accepts and transmits convertible virtual currency as a money transmitter subject to the Bank Secrecy Act.',
    'OFAC sanctions apply to crypto the same as to fiat; U.S. persons must not transact with sanctioned persons or blocked addresses.',
    'The IRS treats convertible virtual currency as property, so a sale or swap can be a taxable event.',
    'As of November 2026, the wash-sale rule in IRC §1091 generally does not apply to typical crypto held as property, though it can apply to tokenized securities and crypto ETFs.',
    'Brokers must report digital asset sales on Form 1099-DA; cost basis reporting for certain covered assets begins with sales in tax year 2026.',
    'Cletus is not a registered broker-dealer or investment adviser.',
    'Cletus uses this knowledge to stay away from wash trading and spoofing; that is an internal risk control, not a claim of regulatory compliance.',
  ])('keeps negations and neutral education: %s', ok);

  it('keeps the rest of a mixed answer, removes only the claim sentence, adds each note once', () => {
    const r = bad('Cletus scans Solana pools. It is SEC-approved. It guarantees returns. Losses can happen.\n- Cletus is compliant with CFTC rules');
    expect(r.text).toContain('Cletus scans Solana pools.');
    expect(r.text).toContain('Losses can happen.');
    expect(r.text).not.toMatch(/SEC-approved|guarantees returns|compliant with CFTC/);
    expect(r.text.split(COMPLIANCE_NOTE).length).toBe(2);
    expect(r.text.split(RETURNS_NOTE).length).toBe(2);
    expect(r.hits.sort()).toEqual(['compliance', 'returns']);
  });

  it('handles markdown emphasis and empty input', () => {
    expect(bad('**Cletus is fully SEC compliant.**').text).toBe(COMPLIANCE_NOTE);
    expect(filterClaims('')).toEqual({ text: '', changed: false, hits: [] });
  });
});
