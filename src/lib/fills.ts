/**
 * Realistic simulated fills on a constant-product pool (pure; unit-tested).
 * A pool with total liquidity L (USD, both sides) has about R = L/2 of quote reserve.
 *   buy  x USD -> average price = p * (1 + x / R)
 *   sell v USD -> average price = p * R / (R + v)
 * Unknown liquidity falls back to a fixed `fallbackImpact`. Fees are charged separately.
 * Stops fill at the OBSERVED price when it gaps through the level, never at the level itself.
 */
export function simFillPrice(side: 'buy' | 'sell', price: number, notionalUsd: number, liquidityUsd: number | null | undefined, fallbackImpact = 0.01): number {
  if (!(price > 0)) return price;
  if (!(liquidityUsd && liquidityUsd > 0)) return side === 'buy' ? price * (1 + fallbackImpact) : price * (1 - fallbackImpact);
  const R = liquidityUsd / 2;
  return side === 'buy' ? price * (1 + notionalUsd / R) : (price * R) / (R + notionalUsd);
}
