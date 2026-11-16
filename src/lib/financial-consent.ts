/**
 * Five-stage, server-validated financial understanding flow.
 * Correct answers are checked server-side; a client checkbox alone is not consent.
 * This is an educational acknowledgement, not legal advice or a guarantee of comprehension.
 */
export const FINANCIAL_CONSENT_VERSION = "2026-11-16.1";

export const FINANCIAL_CONSENT_STAGES = [
  {
    id: "loss-risk",
    title: "1 of 5 — Loss is possible",
    explanation: "Cryptoassets can fall sharply. You can lose some or all of the money you choose to put at risk. Cletus cannot protect your principal or guarantee a recovery.",
    question: "What is a possible outcome when you trade cryptoassets?",
    options: [
      { value: "partial-or-total-loss", label: "I can lose some or all of the money I put at risk." },
      { value: "principal-protected", label: "Cletus protects my original amount." },
      { value: "loss-recovered", label: "Cletus automatically earns back losses." },
    ],
    correctValue: "partial-or-total-loss",
    confirmation: "I understand that I may lose some or all of the money I choose to risk.",
  },
  {
    id: "uncertainty",
    title: "2 of 5 — No prediction is a promise",
    explanation: "Signals, AI analysis, forecasts, backtests, simulations, and historical results can be wrong. Past performance does not establish future results. Fees, slippage, outages, liquidity changes, and scams can make outcomes worse.",
    question: "What do backtests and AI predictions guarantee about future results?",
    options: [
      { value: "guaranteed-results", label: "They guarantee future profits if followed." },
      { value: "no-guarantee", label: "They do not guarantee future performance or returns." },
      { value: "loss-limit", label: "They guarantee losses will stay within the backtest." },
    ],
    correctValue: "no-guarantee",
    confirmation: "I understand that AI outputs and historical results are uncertain and do not guarantee returns.",
  },
  {
    id: "wallet-security",
    title: "3 of 5 — Connecting is not signing",
    explanation: "A public wallet connection or Sign-In-With-Solana message can identify an address or prove control of it. It is not a token transfer or swap approval. Never enter a seed phrase or private key into Cletus.",
    question: "What does connecting a wallet or signing a sign-in message authorize?",
    options: [
      { value: "unlimited-trading", label: "It gives Cletus unlimited permission to trade." },
      { value: "fund-transfer", label: "It authorizes Cletus to transfer my assets." },
      { value: "address-auth-only", label: "It identifies or verifies my address; it does not approve a transaction." },
    ],
    correctValue: "address-auth-only",
    confirmation: "I understand that Cletus must never receive my seed phrase or private key.",
  },
  {
    id: "authority-revocation",
    title: "4 of 5 — You remain in control",
    explanation: "Wallet connection is optional and does not grant trading authority. Any future transaction feature must show the exact transaction and require the appropriate explicit authorization in the user's wallet. You can decline, disconnect, and revoke permissions.",
    question: "Who decides whether a transaction from your wallet is approved?",
    options: [
      { value: "ai-decides", label: "The AI decides when a transaction is appropriate." },
      { value: "user-approves", label: "I review and explicitly approve each transaction in my wallet." },
      { value: "wallet-connect", label: "Connecting my wallet approves future transactions automatically." },
    ],
    correctValue: "user-approves",
    confirmation: "I understand that connecting my wallet is not permission for Cletus to trade or move funds.",
  },
  {
    id: "independent-choice",
    title: "5 of 5 — The choice is yours",
    explanation: "You may choose paper-only mode, decline to connect a wallet, or leave the process. Cletus must not pressure you to deposit, trade, stake, borrow, subscribe, or increase risk. You can use unrelated Grove features without connecting a wallet.",
    question: "What can you do if you do not want to connect a wallet?",
    options: [
      { value: "must-connect", label: "I must connect to continue or participate in the Grove." },
      { value: "paper-or-exit", label: "I can choose paper-only mode or leave without connecting." },
      { value: "deposit-first", label: "I must deposit funds before deciding." },
    ],
    correctValue: "paper-or-exit",
    confirmation: "I am making this choice voluntarily and may stop without penalty.",
  },
] as const;

export type FinancialConsentStageId = (typeof FINANCIAL_CONSENT_STAGES)[number]["id"];

export type FinancialConsentValidation =
  | { ok: true }
  | { ok: false; error: string };

export function validateFinancialConsentStage(
  body: unknown,
  currentVersion: string,
  expectedStage: FinancialConsentStageId | null,
): FinancialConsentValidation {
  const value = (body ?? {}) as Record<string, unknown>;
  if (value.version !== currentVersion) {
    return { ok: false, error: "Financial consent version changed. Reload and review the current information." };
  }
  if (!expectedStage) {
    return { ok: false, error: "All financial understanding stages are already complete." };
  }
  if (value.stage !== expectedStage) {
    return { ok: false, error: "Complete the stages in order. Reload to continue at the next required stage." };
  }
  const stage = FINANCIAL_CONSENT_STAGES.find((item) => item.id === expectedStage);
  if (!stage || value.answer !== stage.correctValue) {
    return { ok: false, error: "That answer does not show understanding of this risk. Review the explanation and try again." };
  }
  if (value.confirmed !== true) {
    return { ok: false, error: "Please confirm that you understand this stage before continuing." };
  }
  return { ok: true };
}
