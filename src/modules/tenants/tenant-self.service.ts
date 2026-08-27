import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../notifications/notifications.service';
import { TenantNotificationTemplates } from '../notifications/templates/tenant.templates';
import { TENANT_SELECT } from './tenant-select';
import { BankingDto, UpdateMyTenantDto } from './dto/tenant-self.dto';

interface BankingSnapshot {
  bankingAccountNumber: string | null;
  bankingBankName: string | null;
  bankingAccountName: string | null;
}

/** Did the account actually change? Ported from the old `bankingChanged` helper. */
function bankingChanged(before: BankingSnapshot, after: BankingSnapshot) {
  return (
    before.bankingAccountNumber !== after.bankingAccountNumber ||
    before.bankingBankName !== after.bankingBankName ||
    before.bankingAccountName !== after.bankingAccountName
  );
}

/** Enough of an account to be worth linking. Ported from `hasBankInfo`. */
function hasBankInfo(banking: BankingSnapshot) {
  return Boolean(banking.bankingAccountNumber && banking.bankingBankName);
}

/**
 * A shop reading and editing **its own** record — iKiotMS-BE's `/tenant/me`,
 * `/tenant/banking` and `/tenant/:tenantId/sepay-key`.
 *
 * Separate from `TenantService`, which is the platform-admin CRUD over every tenant. The
 * split matters: this one never takes a tenant id from the caller (it comes off the access
 * token), so there is no path through it to another shop's row.
 *
 * **This is what makes SePay order payments usable at all.** `OrderService.requireBanking`
 * refuses a SEPAY sale until `bankingBankName`/`bankingAccountNumber` are set, and until
 * these routes were ported there was no way to set them short of writing to the database
 * by hand.
 *
 * The linking itself is manual, and the two notifications here are the workflow: saving an
 * account tells the operators there is one to link, and linking it tells the shop they can
 * start taking QR payments.
 */
@Injectable()
export class TenantSelfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * The shop's own record.
   *
   * `hasSepayKey` instead of the key itself — the old `getTenant` did exactly this, and it
   * is the right shape: the settings screen needs to show whether the account is linked,
   * and nothing needs the secret back.
   */
  async findMine(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { ...TENANT_SELECT, bankingSepayWebhookApiKey: true },
    });
    if (!tenant) throw new NotFoundException('Không tìm thấy cửa hàng');

    const { bankingSepayWebhookApiKey, ...rest } = tenant;
    return { ...rest, hasSepayKey: Boolean(bankingSepayWebhookApiKey) };
  }

  /** `PUT /tenant/me`. Sends the operators a heads-up when the bank account changes. */
  async updateMine(tenantId: string, dto: UpdateMyTenantDto) {
    const before = await this.bankingOf(tenantId);

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        name: dto.name,
        phoneNumber: dto.phoneNumber,
        mainAddress: dto.mainAddress,
        taxNumber: dto.taxNumber,
        ...(dto.banking
          ? {
              bankingAccountNumber: dto.banking.accountNumber,
              bankingBankName: dto.banking.bankName,
              bankingAccountName: dto.banking.accountName,
            }
          : {}),
      },
      select: TENANT_SELECT,
    });

    if (dto.banking) await this.announceBankChange(before, tenant);
    return tenant;
  }

  /** `PUT /tenant/banking` — the same write on its own route, as the old API had it. */
  async updateBanking(tenantId: string, dto: BankingDto) {
    const before = await this.bankingOf(tenantId);

    const tenant = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        bankingAccountNumber: dto.accountNumber,
        bankingBankName: dto.bankName,
        bankingAccountName: dto.accountName,
      },
      select: TENANT_SELECT,
    });

    await this.announceBankChange(before, tenant);
    return tenant;
  }

  /**
   * Records the SePay webhook key an operator has provisioned for a shop, and tells the
   * shop's owners they can start taking QR payments.
   *
   * **Platform-admin only** — enforced by `AdminOnlyGuard` on the route. iKiotMS-BE's
   * comment said "SUPER_ADMIN" but nothing checked it: the route carried only
   * `authorize('tenants','update')` and the handler read `req.params.tenantId` unscoped,
   * so any account with that permission could write **any** shop's key. Since the key is
   * what identifies a tenant to the payment webhook, that let one shop's settings reach
   * another shop's money. The two admin routes beside it did check the role, which is what
   * makes this look like an oversight rather than a design.
   */
  async setSepayKey(tenantId: string, sepayWebhookApiKey: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Không tìm thấy cửa hàng');

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { bankingSepayWebhookApiKey: sepayWebhookApiKey },
    });

    const owners = await this.notifications.tenantOwners(tenantId);
    await this.notifications.notify({
      tenantId,
      recipientIds: owners,
      referenceId: tenantId,
      ...TenantNotificationTemplates.sepayLinked(),
    });

    return { message: 'SePay key saved' };
  }

  private async bankingOf(tenantId: string): Promise<BankingSnapshot> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        bankingAccountNumber: true,
        bankingBankName: true,
        bankingAccountName: true,
      },
    });
    if (!tenant) throw new NotFoundException('Không tìm thấy cửa hàng');
    return tenant;
  }

  /** Only when the details really moved, and only once they are worth linking. */
  private async announceBankChange(
    before: BankingSnapshot,
    after: BankingSnapshot & { name: string },
  ) {
    if (!bankingChanged(before, after) || !hasBankInfo(after)) return;
    await this.notifications.notifySystem(
      TenantNotificationTemplates.bankAccountUpdated(
        after.name,
        after.bankingBankName,
        after.bankingAccountNumber,
      ),
    );
  }
}
