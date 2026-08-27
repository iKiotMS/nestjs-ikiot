import type { Prisma } from '../../../generated/prisma/client';

/**
 * Every Tenant column **except `bankingSepayWebhookApiKey`**.
 *
 * That column is a shared secret, and it is more than a password: `SepayOrderService`
 * identifies which tenant a payment webhook belongs to *by* the key, so anyone holding one
 * can settle that shop's orders. Prisma has no `select: false` the way Mongoose did — the
 * field the old schema deliberately hid came back by default the moment the model was
 * ported — so the exclusion has to be spelled out, once, here.
 *
 * **Listing the safe columns rather than the secret one is the point.** A column added to
 * the schema later is invisible until someone adds it here, which is the right way round
 * for a model that holds credentials.
 *
 * Shared by `TenantService` (platform-admin CRUD) and `TenantSelfService` (a shop's own
 * record) so the two cannot disagree about what is safe to return. `findMine` re-adds the
 * key to its own query only to answer `hasSepayKey: boolean`, never to return it.
 */
export const TENANT_SELECT = {
  id: true,
  name: true,
  tenantOwnerId: true,
  status: true,
  phoneNumber: true,
  mainAddress: true,
  taxNumber: true,
  bankingAccountNumber: true,
  bankingBankName: true,
  bankingAccountName: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.TenantSelect;
