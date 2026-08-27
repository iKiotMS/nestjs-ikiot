import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';
import { normalizePhone } from '../../common/utils/phone';
import { EsmsService } from './esms.service';

const OTP_TTL_SECONDS = 5 * 60;

interface OtpEntry {
  code: string;
  expiresAt: number;
}

/**
 * Ported from iKiotMS-BE's `src/services/otpService.js`, now including the half the first
 * NestJS pass had to leave out: **codes live in Redis**, with the same in-memory fallback
 * the old file carried for when Redis is unreachable.
 *
 * Two things about that fallback. It is what keeps local development working without a
 * Redis container, and it is explicitly *not* good enough for more than one instance —
 * a code minted on one process cannot be verified on another. It is the old behaviour,
 * kept deliberately, not an oversight.
 *
 * Keys are `normalizePhone`d. The old service did this and the first port did not, which
 * meant a code requested as `0912345678` would not verify when the confirm step sent
 * `+84912345678` — the same number, two keys.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly fallback = new Map<string, OtpEntry>();

  constructor(
    private readonly esms: EsmsService,
    private readonly redis: RedisService,
  ) {}

  private keyFor(phone: string): string {
    return `otp:register:${normalizePhone(phone)}`;
  }

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

  private async store(phone: string, code: string): Promise<void> {
    const key = this.keyFor(phone);
    if (await this.redis.set(key, code, OTP_TTL_SECONDS)) return;
    this.fallback.set(key, {
      code,
      expiresAt: Date.now() + OTP_TTL_SECONDS * 1000,
    });
  }

  private async read(phone: string): Promise<string | null> {
    const key = this.keyFor(phone);
    const fromRedis = await this.redis.get(key);
    if (fromRedis !== null) return fromRedis;

    const entry = this.fallback.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.fallback.delete(key);
      return null;
    }
    return entry.code;
  }

  private async clear(phone: string): Promise<void> {
    const key = this.keyFor(phone);
    await this.redis.del(key);
    this.fallback.delete(key);
  }

  /** Generates + stores an OTP and dispatches it via eSMS. When eSMS isn't configured
   * in dev, the code is logged to the console instead of sending a real SMS. */
  async sendOtp(phoneNumber: string): Promise<{ sent: true }> {
    if (!phoneNumber) throw new BadRequestException('Phone number is required');

    const code = this.generateCode();
    await this.store(phoneNumber, code);

    if (this.esms.isConfigured()) {
      await this.esms.sendOtpSms(phoneNumber, code);
    } else if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`📱 [DEV OTP] ${normalizePhone(phoneNumber)} -> ${code}`);
    } else {
      throw new BadRequestException('SMS service is not configured');
    }

    return { sent: true };
  }

  /** Verifies a submitted OTP against the stored value, consuming it on success. */
  async verifyOtp(phoneNumber: string, code: string): Promise<true> {
    if (this.isDevBypass(code)) return true;

    const stored = await this.read(phoneNumber);
    if (stored === null) {
      throw new BadRequestException(
        'OTP has expired or was not requested. Please request a new code.',
      );
    }
    if (String(code).trim() !== stored) {
      throw new BadRequestException('Invalid OTP code');
    }

    await this.clear(phoneNumber);
    return true;
  }
}
