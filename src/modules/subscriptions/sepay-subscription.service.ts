import { Injectable } from '@nestjs/common';
import {
  generateReference,
  REFERENCE_PREFIX,
} from '../../common/utils/reference-generator';

// Ported from the subscription half of iKiotMS-BE's src/services/sepayService.js. Kept
// as its own service, not shared with order payments: this integration pays into
// iKiot's own company bank account (SEPAY_ACCOUNT_*), a structurally different flow from
// order payments (which use each tenant's own banking.* fields + a separate webhook key
// stored per-tenant) — see CLAUDE.md, don't merge the two when order payments get ported.
@Injectable()
export class SepaySubscriptionService {
  generatePaymentReference(): string {
    return generateReference(REFERENCE_PREFIX.SUBSCRIPTION);
  }

  buildQrUrl(amount: number, paymentReference: string): string {
    const accountNumber = process.env.SEPAY_ACCOUNT_NUMBER ?? '';
    const bankName = process.env.SEPAY_BANK_NAME ?? '';
    const accountName = process.env.SEPAY_ACCOUNT_NAME ?? '';
    return (
      `https://img.vietqr.io/image/${bankName}-${accountNumber}-compact2.png` +
      `?amount=${amount}&addInfo=${encodeURIComponent(paymentReference)}&accountName=${encodeURIComponent(accountName)}`
    );
  }

  verifyWebhookKey(receivedKey: string): boolean {
    const expectedKey = process.env.SEPAY_WEBHOOK_API_KEY ?? '';
    return Boolean(expectedKey) && receivedKey === expectedKey;
  }

  /** {6,10}: refs minted before generateReference standardised on 5 bytes are 6 hex. */
  extractReference(content = ''): string | null {
    const match = content.match(/IKMS[0-9A-F]{6,10}/i);
    return match ? match[0].toUpperCase() : null;
  }
}
