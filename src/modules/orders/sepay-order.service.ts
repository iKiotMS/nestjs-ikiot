import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateReference,
  REFERENCE_PREFIX,
} from '../../common/utils/reference-generator';

/**
 * The order half of iKiotMS-BE's `src/services/sepayService.js`.
 *
 * Deliberately a separate service from `SepaySubscriptionService`, which CLAUDE.md has
 * warned about since the subscription port: that one pays **iKiot's** company account from
 * env vars, this one pays **each tenant's own** account from their `banking.*` columns and
 * identifies the tenant by a per-tenant webhook key. They share a QR provider and a
 * reference-code shape and nothing else — merging them would mean one integration's
 * credentials could settle the other's invoices.
 */
@Injectable()
export class SepayOrderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every order gets an `ORD` reference, not just SePay ones — the prefix is what makes a
   * CashFlow row identifiable as sales revenue later. Only SePay puts it in a QR code.
   */
  generateOrderReference(): string {
    return generateReference(REFERENCE_PREFIX.ORDER);
  }

  buildQrUrl(
    banking: {
      bankingBankName: string | null;
      bankingAccountNumber: string | null;
      bankingAccountName: string | null;
    },
    amount: number,
    paymentReference: string,
  ): string {
    const bankName = banking.bankingBankName ?? '';
    const accountNumber = banking.bankingAccountNumber ?? '';
    const accountName = banking.bankingAccountName ?? '';
    return (
      `https://img.vietqr.io/image/${bankName}-${accountNumber}-compact2.png` +
      `?amount=${amount}&addInfo=${encodeURIComponent(paymentReference)}&accountName=${encodeURIComponent(accountName)}`
    );
  }

  /**
   * `{6,10}` rather than `{10}`: references minted before the random space was widened are
   * 6 hex characters, and orders carrying them may still be PENDING. Greedy, so a current
   * 10-character reference still matches in full.
   */
  extractOrderReference(content = ''): string | null {
    const match = content.match(/ORD[0-9A-F]{6,10}/i);
    return match ? match[0].toUpperCase() : null;
  }

  /**
   * Which tenant a webhook call belongs to. The key is the only thing identifying the
   * caller, so an unknown one resolves to null and the caller answers "unknown key"
   * without saying anything more.
   */
  async findTenantByWebhookKey(apiKey: string) {
    if (!apiKey) return null;
    return this.prisma.tenant.findFirst({
      where: { bankingSepayWebhookApiKey: apiKey },
      select: { id: true },
    });
  }
}
