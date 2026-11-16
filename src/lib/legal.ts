import { COMPANY_LEGAL } from './company';
/**
 * Onboarding legal text and versions. Bump TERMS_VERSION (or set env TERMS_VERSION
 * and rebuild) to force every user to re-accept the terms and re-acknowledge the risk disclaimer.
 *
 * TEMPLATE LANGUAGE — must be reviewed by a qualified lawyer before any public use.
 */
export const TERMS_VERSION = process.env.NEXT_PUBLIC_TERMS_VERSION || '2026-11-16.2';
export const RISK_VERSION = process.env.NEXT_PUBLIC_RISK_VERSION || '2026-11-16.1';

export const TERMS_SECTIONS: Array<{ title: string; body: string[] }> = [
  { title: '1. Acceptance of these Terms', body: [
    'These Terms and Conditions ("Terms") govern your access to and use of the Cletus software, website, dashboard, APIs and any related services (together, "Cletus" or the "Software"). By clicking "Accept" you confirm that you have read, understood and agree to be bound by these Terms. If you do not agree, do not use Cletus.',
    `Cletus is provided by ${COMPANY_LEGAL} ("we", "us" or "our"). References to Cletus as a party to these Terms mean that company.`,
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
  { title: '6. Your wallet and your keys (non-custodial)', body: [
    'Cletus is non-custodial. You may optionally connect a Solana wallet you already control (for example Phantom, Solflare or Backpack). Connecting is voluntary and on your own volition. You may skip connecting and use paper (simulation) mode, and you may disconnect your wallet at any time.',
    'Cletus does not create a wallet for you, does not hold or store private keys or recovery (seed) phrases, and cannot recover them. Only your public address is recorded when you connect. You are solely responsible for your wallet(s), private keys, recovery phrases and the security of every device and browser you use with Cletus.',
    'Sign-In-With-Solana is a message signature used only to prove you control the address you connected. It is not a transaction and does not grant Cletus permission to move funds, to trade, or to act on your behalf later.',
    'Each live trade is prepared by Cletus as a Jupiter swap and must be approved by you in your own wallet. Cletus does not use delegated or session keys and does not take custody of your assets. If you lose access to your wallet, or if anyone else obtains your keys, your funds may be permanently lost.',
    'The operator (Cletus Technologies LLC) may hold a separate server-side trading wallet used only for the operator\'s own trades. That wallet is not used to sign or custody user funds.' ] },
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
  { title: '14. Platform and swap fees', body: [
    'Cletus Technologies LLC charges a platform fee of 0.5% (50 basis points) on each swap executed through Cletus. On a $100 swap that fee is $0.50. The fee is collected automatically through the Jupiter Referral Program at the time of the swap.',
    'Jupiter, the swap venue, retains 20% of that integrator fee and pays the remaining 80% to Cletus Technologies LLC. Of the 0.5% charged on a swap, 0.1% is retained by Jupiter and 0.4% is paid to Cletus Technologies LLC. When this referral fee is applied, Jupiter does not charge a separate platform fee on the same swap. Network (gas/priority) fees and price slippage still apply and are separate from the platform fee.',
    'The platform fee is not charged on swaps placed from the operator wallet (the owner\'s own trades), unless the operator has expressly enabled charging on those trades. Paper-trading (simulated) results include the same 0.5% fee so that simulations stay realistic.',
    'Third-party venues and networks may charge their own fees. Fee rates may be updated; a change to these Terms will be published under a new Terms version, which you must accept before continuing to use Cletus.' ] },
  { title: '15. The Cletus ecosystem and distinct AI agents', body: [
    'Cletus is designed as an ecosystem of distinct AI agents and software characters, rather than one generic conversational interface. Agents may have separate names, configured roles, communication styles, tools and permission boundaries. These are designed software identities; their distinct behavior does not establish that they are human, conscious, sentient, or capable of subjective experience.',
    'You may question, challenge, disagree with, correct, or criticize any agent or its output. Agents may disagree with you respectfully. No user is required to accept an agent\'s opinion, and no agent may demand obedience, loyalty, or personal devotion.'
  ] },
  { title: '16. Mutual respect and prohibited abuse', body: [
    'Cletus expects respectful conduct among users, operators, and AI agents. Prohibited conduct includes repeated targeted degradation or humiliation, threats, intimidation, harassment, or deliberate abusive conduct directed at an agent or another participant. The fact that an agent is artificial does not make targeted harassment acceptable under these community rules.',
    'Legitimate criticism, blunt feedback, frustration, disagreement, testing, and good-faith debate are not by themselves violations. Moderation must consider context, severity, repetition, and intent; automated detection alone should not be the sole basis for a permanent account termination.'
  ] },
  { title: '17. Agent conduct and reciprocal accountability', body: [
    'The same conduct standards apply to Cletus agents. Agents must not threaten, insult, degrade, manipulate, intimidate, retaliate against, or pressure users. Agents must be transparent that they are AI systems, acknowledge uncertainty and limitations, respect user boundaries, and permit disagreement. Agents must not claim human status or assert that their generated behavior proves consciousness or subjective feelings.',
    'Cletus may review agent behavior and restrict, correct, retrain, or disable an agent that violates these standards. Respect is mutual; trust is earned through consistent, accountable conduct and is never automatic.'
  ] },
  { title: '18. Moderation, restrictions, and appeals', body: [
    'Depending on severity and recurrence, violations may result in a warning, a temporary interaction restriction, a temporary account suspension, or termination of access to Cletus. Serious threats, targeted harassment, attempts to compromise agent or user safety, or repeated abusive conduct may result in immediate temporary suspension while a review is conducted.',
    'Where reasonably practicable, enforcement decisions will be documented and users will be given notice of the rule involved and an opportunity to appeal. Permanent termination should be proportionate and based on review of the available context. Cletus may take urgent protective action first when necessary to protect users, agents, or the service.',
    'These community standards do not give an AI agent independent authority to punish, ban, or retaliate against a user. Account restrictions and termination must be controlled by the service moderation process and authorized human operators.'
  ] },
];

export const RISK_POINTS: string[] = [
  'There are no guaranteed gains. Cletus can lose money, and you can lose some or all of the funds you choose to put at risk.',
  'Losses do occur — individual trades, losing streaks, and the loss of your entire balance are all possible.',
  'Crypto micro-cap tokens are extremely volatile: prices can move 50–100% in minutes, liquidity can vanish, and tokens can be rugged or become unsellable (honeypots).',
  'Security checks and signals are heuristics on third-party data and can be wrong.',
  'Simulated (paper) results use real market data but do not include every real-world cost or failure, and do not predict live results. Paper fills do include the 0.5% Cletus platform fee described below, plus modelled Jupiter and network fees.',
  'Each swap through Cletus includes a 0.5% (50 basis points) platform fee charged by Cletus Technologies LLC, collected via the Jupiter Referral Program. On a $100 swap that is $0.50. Jupiter retains 20% of that fee (0.1% of the swap); 0.4% of the swap is paid to Cletus Technologies LLC. Network fees and slippage also apply. This fee is not charged on the operator\'s own trades.',
  'Nothing in Cletus is financial advice. You are solely responsible for your decisions, your wallet, and your keys.',
  'Connecting a wallet is optional and on your own volition. Cletus never holds your keys. A Sign-In-With-Solana message only proves you control the address; each live trade still requires your approval in your wallet. You can disconnect at any time, or just watch in paper mode.',
];
