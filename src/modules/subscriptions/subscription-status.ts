import { addDays, GRACE_PERIOD_DAYS } from './subscription.constants';

/** The lifecycle a Subscription.status moves through. */
export const SubscriptionStatus = {
  TRIAL: 'TRIAL',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export type SubscriptionStatus =
  (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

/** Only the three fields the transition rules look at. */
export interface SubscriptionTerm {
  status: string;
  endDate: Date;
  trialEndDate: Date | null;
}

/**
 * THE expiry rules — the single copy in the codebase.
 *
 * Returns the status the subscription should be in at `now`, which is the same status it
 * already has whenever nothing is due to change. Two callers apply it:
 *
 *  - `SubscriptionService.settleSubscription()`, lazily, whenever somebody reads a
 *    subscription (so a tenant is never served on a term that quietly ran out); and
 *  - `SubscriptionCronService`, nightly, so the notifications and the reporting numbers
 *    don't wait for the tenant to log in.
 *
 * Those two used to carry their own hand-written copy of these conditions, and had already
 * drifted: the lazy one let ACTIVE go straight to EXPIRED past the grace period, the cron
 * one insisted on a PAST_DUE stop first. Never re-implement this at a call site.
 */
export function nextSubscriptionStatus(
  subscription: SubscriptionTerm,
  now: Date,
): string {
  if (subscription.status === SubscriptionStatus.TRIAL) {
    const trialIsOver =
      subscription.trialEndDate !== null && now > subscription.trialEndDate;
    return trialIsOver ? SubscriptionStatus.EXPIRED : SubscriptionStatus.TRIAL;
  }

  if (
    subscription.status !== SubscriptionStatus.ACTIVE &&
    subscription.status !== SubscriptionStatus.PAST_DUE
  ) {
    // EXPIRED and CANCELLED are terminal — only a payment moves them, not the clock.
    return subscription.status;
  }

  // Past the grace period that follows the paid term: no longer recoverable.
  if (subscription.endDate < addDays(now, -GRACE_PERIOD_DAYS)) {
    return SubscriptionStatus.EXPIRED;
  }
  // Term is over but still inside the grace period: keep serving the tenant.
  if (now > subscription.endDate) return SubscriptionStatus.PAST_DUE;

  return subscription.status;
}
