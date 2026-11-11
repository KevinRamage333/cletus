import type { User } from '@prisma/client';
export const TRIAL_DAYS = 30;
/** 30-day trial flag (informational only; there is no billing in the beta). Starts at sign-up. */
export function trialInfo(u: Pick<User, 'createdAt' | 'trialStartedAt'>, now = Date.now()) {
  const start = (u.trialStartedAt ?? u.createdAt).getTime();
  const daysRemaining = Math.max(0, Math.ceil((start + TRIAL_DAYS * 86_400_000 - now) / 86_400_000));
  return { trialStartedAt: new Date(start).toISOString(), trialDays: TRIAL_DAYS, trialActive: daysRemaining > 0, daysRemaining };
}
