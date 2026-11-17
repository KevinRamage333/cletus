/** Sum recorded entry, partial-exit and final-exit fees without allowing invalid values through. */
export function totalTradeFees(...fees: Array<number | null | undefined>): number {
  return fees.reduce((total, fee) => total + (typeof fee === 'number' && Number.isFinite(fee) && fee > 0 ? fee : 0), 0);
}
