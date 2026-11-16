/** Explicit opt-in guard for scripts that can sign or broadcast real transactions. */
export const LIVE_TRADING_ACK = 'I_UNDERSTAND_THIS_CAN_LOSE_FUNDS';

export function assertLiveTradingAcknowledged(env: Record<string, string | undefined> = process.env): void {
  if (env.CLETUS_LIVE_TRADING_ACK !== LIVE_TRADING_ACK) {
    throw new Error(`Live execution blocked: set CLETUS_LIVE_TRADING_ACK=${LIVE_TRADING_ACK} to explicitly authorize real transactions`);
  }
}
