import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { EsmsService } from './esms.service';

const OTP_TTL_MS = 5 * 60 * 1000;

interface OtpEntry {
  code: string;
  expiresAt: number;
}

// Ported from iKiotMS-BE's src/services/otpService.js. That version stored codes in
// Redis with an in-memory fallback when Redis was unreachable; this one is in-memory
// only for now (Redis isn't wired into iKiot-BE yet — see refresh-token note in
// CLAUDE.md, same story applies here: revisit once Redis is wired, since an in-memory
// Map won't survive a restart or work across multiple instances).
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly store = new Map<string, OtpEntry>();

  constructor(private readonly esms: EsmsService) {}

  private generateCode(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /** In dev, an empty code or the sentinel token skips OTP verification — same escape
   * hatch as the old system's DEV_OTP_BYPASS_TOKEN, disabled outright in production. */
  private isDevBypass(code: string): boolean {
    if (process.env.NODE_ENV === 'production') return false;
    const sentinel = process.env.DEV_OTP_BYPASS_TOKEN || 'DEV_BYPASS';
    return !code || code === sentinel;
  }

  /** Generates + stores an OTP and dispatches it via eSMS. When eSMS isn't configured
   * in dev, the code is logged to the console instead of sending a real SMS. */
  async sendOtp(phoneNumber: string): Promise<{ sent: true }> {
    if (!phoneNumber) throw new BadRequestException('Phone number is required');

    const code = this.generateCode();
    this.store.set(phoneNumber, { code, expiresAt: Date.now() + OTP_TTL_MS });

    if (this.esms.isConfigured()) {
      await this.esms.sendOtpSms(phoneNumber, code);
    } else if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`📱 [DEV OTP] ${phoneNumber} -> ${code}`);
    } else {
      throw new BadRequestException('SMS service is not configured');
    }

    return { sent: true };
  }

  /** Verifies a submitted OTP against the stored value, consuming it on success. */
  verifyOtp(phoneNumber: string, code: string): true {
    if (this.isDevBypass(code)) return true;

    const entry = this.store.get(phoneNumber);
    if (!entry || entry.expiresAt < Date.now()) {
      this.store.delete(phoneNumber);
      throw new BadRequestException(
        'OTP has expired or was not requested. Please request a new code.',
      );
    }
    if (String(code).trim() !== entry.code) {
      throw new BadRequestException('Invalid OTP code');
    }

    this.store.delete(phoneNumber);
    return true;
  }
}
