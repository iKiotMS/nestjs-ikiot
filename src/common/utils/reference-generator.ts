import { randomBytes } from 'node:crypto';

// Ported from iKiotMS-BE's src/utils/referenceGenerator.js + src/constants/referencePrefix.js.
// One generator for every reference code — pass a prefix from REFERENCE_PREFIX. 5 random
// bytes (2^40) keeps birthday collisions negligible even against a global-unique index
// (e.g. Order.paymentReference across every tenant) — don't lower byteLength without reason.
export function generateReference(prefix: string, byteLength = 5): string {
  return prefix + randomBytes(byteLength).toString('hex').toUpperCase();
}

/** Anchored regex to find/filter references of a given flow, e.g. referenceMatcher('ORD') -> /^ORD/i. */
export function referenceMatcher(prefix: string): RegExp {
  return new RegExp('^' + prefix, 'i');
}

// Values are PERSISTED on historical rows — never rename an existing prefix, only add.
export const REFERENCE_PREFIX = {
  ORDER: 'ORD',
  SUPPLIER: 'SUP',
  PAYROLL: 'PAYR',
  SUBSCRIPTION: 'IKMS', // tenant pays iKiot for a plan (company bank — not tenant CashFlow)
} as const;

export const CASHFLOW_PREFIXES = [
  REFERENCE_PREFIX.ORDER,
  REFERENCE_PREFIX.SUPPLIER,
  REFERENCE_PREFIX.PAYROLL,
];
