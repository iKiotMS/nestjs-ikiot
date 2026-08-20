/**
 * How money actually moved. The set is the one CashFlow.paymentMethod documents in
 * prisma/schema.prisma; iKiotMS-BE never declared it as a constant, each module wrote the
 * strings inline.
 */
export const PaymentMethod = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  MOMO: 'MOMO',
  VNPAY: 'VNPAY',
  SEPAY: 'SEPAY',
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PAYMENT_METHODS: readonly string[] = Object.values(PaymentMethod);
