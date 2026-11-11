/**
 * Onboarding legal text and versions. Bump TERMS_VERSION (or set env TERMS_VERSION
 * and rebuild) to force every user to re-accept the terms and re-acknowledge the risk disclaimer.
 *
 * TEMPLATE LANGUAGE — must be reviewed by a qualified lawyer before any public use.
 */
export const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION || '2026-11-11.1';
export const RISK_VERSION = TERMS_VERSION;

export const TERMS_SECTIONS: Array<{ title: string; body: string[] }> = [
  { title: '1. Acceptance of these Terms', body: [
    'These Terms and Conditions ("Terms") govern your access to and use of the Cletus software, website, dashboard, APIs and any related services (together, "Cletus" or the "Software"). By clicking "Accept" you confirm that you have read, understood and agree to be bound by these Terms. If you do not agree, do not use Cletus.',
    'You must be of legal age in your jurisdiction and legally permitted to use automated trading software and to hold and trade digital assets. You are solely responsible for complying with the laws, regulations and tax rules that apply to you.' ] },
  { title: '2. Cletus is not a financial advisor', body: [
    'Cletus is an experimental software tool. Cletus, its authors, operators and contributors are NOT registered investment advisers, broker-dealers, financial planners, tax advisers or fiduciaries, and do not act in any such capacity toward you.',
    'Cletus does not know your financial situation, objectives or risk tolerance and does not provide personalised recommendations.' ] },
  { title: '3. Nothing is investment advice', body: [
    'Nothing produced by Cletus — including signals, scores, rankings, dashboards, simulated ("paper") results, AI "Brain" chat answers, logs, documentation or any other output — is investment, financial, legal or tax advice, or an offer, solicitation or recommendation to buy, sell or hold any asset.',
    'AI-generated answers may be inaccurate, incomplete or outdated. You must make your own independent decisions and should consult a licensed professional before making any financial decision.' ] },
  { title: '4. Losses will happen, including total loss', body: [
    'Trading digital assets, and especially low-liquidity Solana micro-cap tokens, is extremely risky. You WILL experience losing trades. You can lose some or ALL of the funds you commit, quickly and without warning, including through rug pulls, honeypots, exploits, smart-contract failures, liquidity disappearing, extreme slippage, failed or delayed transactions, network outages and software bugs.',
    'Security checks performed by Cletus (such as authority, liquidity-lock, honeypot and holder-concentration checks) are heuristics based on third-party data. They can be wrong and do not prevent losses.',
    'Only use funds you can afford to lose entirely.' ] },
  { title: '5. No guaranteed gains', body: [
    'There are no guaranteed gains, returns, profits or outcomes of any kind. No statement anywhere about Cletus should be read as a promise or projection of returns. Past performance, backtests and simulated/paper-trading results do not predict future results; live results may be materially worse because of fees, slippage, latency and failed transactions.' ] },
  { title: '6. Your wallet and your keys', body: [
    'You are solely responsible for your own wallet(s), private keys, recovery (seed) phrases and passwords. Wallets created in the browser are generated on your device and stored encrypted only in your browser; Cletus never receives your recovery phrase or private key and cannot recover them. If you lose your recovery phrase or password, your funds may be permanently lost. If anyone else obtains them, they can take your funds.',
    'You are responsible for the security of every device, browser, server and environment you use with Cletus, including any server-side trading wallet you configure.' ] },
  { title: '7. Assumption of risk', body: [
    'You expressly understand and assume all risks of using Cletus and of trading digital assets, including market, liquidity, counterparty, technology, regulatory, tax and security risks, and the risk of total loss. You use Cletus voluntarily and entirely at your own risk.' ] },
  { title: '8. Beta software', body: [
    'Cletus is beta software. Features may be incomplete, change or be removed at any time. By default Cletus runs in simulation (paper-trading) mode, which uses real market data but signs no transactions. Enabling live trading is your own decision and responsibility.' ] },
  { title: '9. Software provided "as is"', body: [
    'CLETUS IS PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, AVAILABILITY OR THAT IT WILL BE ERROR-FREE OR SECURE. Third-party data and services (including DexScreener, RugCheck, Jupiter, Solana RPC providers and Google Gemini) may be wrong, delayed or unavailable.' ] },
  { title: '10. No liability', body: [
    'TO THE MAXIMUM EXTENT PERMITTED BY LAW, IN NO EVENT WILL THE AUTHORS, OPERATORS, CONTRIBUTORS OR AFFILIATES OF CLETUS BE LIABLE FOR ANY LOSS OF FUNDS, LOSS OF PROFITS, TRADING LOSSES, LOSS OF DATA, OR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR PUNITIVE DAMAGES ARISING OUT OF OR RELATING TO YOUR USE OF, OR INABILITY TO USE, CLETUS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.',
    'You agree to indemnify and hold harmless the authors, operators and contributors of Cletus from any claims, losses or expenses arising from your use of Cletus or your violation of these Terms or of any law.' ] },
  { title: '11. Prohibited use', body: [
    'You will not use Cletus for market manipulation, wash trading, spoofing, fraud, money laundering, sanctions evasion or any unlawful purpose, and you will not attempt to disable its safety controls in order to do so.' ] },
  { title: '12. Changes to these Terms', body: [
    'These Terms may be updated. When the Terms version changes you will be required to read and accept the new version before continuing to use Cletus. Your acceptance (user id, Terms version and timestamp) is recorded.' ] },
  { title: '13. Template notice', body: [
    'This document is a template provided for an early beta and has not been reviewed by a lawyer. It must be reviewed and adapted by qualified legal counsel for your jurisdiction before Cletus is offered to anyone else.' ] },
];

export const RISK_POINTS: string[] = [
  'There are NO guaranteed gains. Cletus can and will lose money.',
  'Losses do occur — individual trades, losing streaks, and the loss of your entire balance are all possible.',
  'Crypto micro-cap tokens are extremely volatile: prices can move 50–100% in minutes, liquidity can vanish, and tokens can be rugged or become unsellable (honeypots).',
  'Security checks and signals are heuristics on third-party data and can be wrong.',
  'Simulated (paper) results use real market data but do not include every real-world cost or failure, and do not predict live results.',
  'Nothing in Cletus is financial advice. You are solely responsible for your decisions, your wallet, and your keys.',
];
