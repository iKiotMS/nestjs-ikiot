import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';
import { refreshTokenSecret } from '../../common/config/env';

/** Seven days, the window iKiotMS-BE's RefreshToken documents carried. */
export const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

interface RefreshPayload {
  sub: string;
  /** Which stored session this token is; the id is the Redis key's tail. */
  jti: string;
  type: 'refresh';
}

interface StoredSession {
  userId: string;
  userAgent: string | null;
  issuedAt: number;
}

/**
 * Refresh tokens, in Redis.
 *
 * iKiotMS-BE stored these as a Mongo collection (`token`, `userId`, `expiresAt`,
 * `userAgent`, `isRevoked`, plus a TTL index) and this keeps every behaviour that came
 * with it — rotation on refresh, revocation of the token just used, "revoke every session
 * for this user" on a password change — with the storage swapped for the Redis plan
 * CLAUDE.md has carried since the port began.
 *
 * **The mapping is worth stating.** A row per token becomes a key per token,
 * `refresh:<userId>:<jti>`; Redis' own key expiry replaces the TTL index; and deleting a
 * key replaces `isRevoked: true` — there is no reason to keep a tombstone once the token
 * can no longer be used. "Log this user out everywhere" was `updateMany({ userId })` and
 * is now a SCAN over `refresh:<userId>:*`.
 *
 * **The signed JWT does not contain anything worth stealing.** It carries the user id, a
 * random `jti` and nothing else; the session's real state lives in Redis. A refresh token
 * whose key is gone is simply not a session any more, whatever the signature says — which
 * is what makes logout and revocation actually take effect rather than waiting out an
 * expiry.
 *
 * **If Redis is down**, `RedisService` reports every key as missing, so refreshing fails
 * and the user re-authenticates with their password. That is the deliberate failure mode:
 * a cache outage must not hand out sessions it cannot revoke.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) {}

  private key(userId: string, jti: string): string {
    return `refresh:${userId}:${jti}`;
  }

  private secret(): string {
    return refreshTokenSecret();
  }

  /** Mints a refresh token and records the session it stands for. */
  async issue(userId: string, userAgent?: string): Promise<string> {
    const jti = randomUUID();
    const token = this.jwt.sign(
      { sub: userId, jti, type: 'refresh' } satisfies RefreshPayload,
      { secret: this.secret(), expiresIn: REFRESH_TOKEN_TTL_SECONDS },
    );

    const session: StoredSession = {
      userId,
      userAgent: userAgent ?? null,
      issuedAt: Date.now(),
    };
    const stored = await this.redis.set(
      this.key(userId, jti),
      JSON.stringify(session),
      REFRESH_TOKEN_TTL_SECONDS,
    );
    if (!stored) {
      // Handing back a token we cannot revoke would be worse than not having one: the
      // access token still works, so the caller is logged in, just not refreshable.
      this.logger.warn(
        'Refresh token was not stored (Redis unavailable) — session will not be refreshable',
      );
    }
    return token;
  }

  /**
   * Rotates a refresh token: verifies it, revokes the one presented, issues a new pair.
   *
   * Rotation is ported from `AuthService.refreshAccessToken`, which marked the old token
   * revoked before writing the new one. It matters because a refresh token is a
   * long-lived bearer credential — using one twice means either a bug or a stolen token,
   * and a rotating token turns the second use into a plain failure.
   */
  async rotate(
    token: string,
    userAgent?: string,
  ): Promise<{ userId: string; refreshToken: string }> {
    const payload = this.verify(token);

    const stored = await this.redis.get(this.key(payload.sub, payload.jti));
    if (!stored) {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn hoặc bị thu hồi, vui lòng đăng nhập lại',
      );
    }

    await this.redis.del(this.key(payload.sub, payload.jti));
    const refreshToken = await this.issue(
      payload.sub,
      userAgent ?? this.userAgentOf(stored),
    );
    return { userId: payload.sub, refreshToken };
  }

  /** Logout. Silently does nothing for a token that is already gone or unparseable. */
  async revoke(userId: string, token: string): Promise<void> {
    let payload: RefreshPayload;
    try {
      payload = this.verify(token);
    } catch {
      return;
    }
    // Only the owner may revoke it — a valid token for somebody else is not this user's
    // to end, and the controller takes `userId` from the access token, not the body.
    if (payload.sub !== userId) return;
    await this.redis.del(this.key(userId, payload.jti));
  }

  /**
   * Ends every session a user has. `AuthService.changePassword` and `resetPassword` both
   * did this in the old system, and it is the point of storing sessions at all: changing
   * a password because it leaked has to log the other party out.
   */
  async revokeAllFor(userId: string): Promise<void> {
    const keys = await this.redis.keysMatching(`refresh:${userId}:*`);
    await this.redis.del(...keys);
  }

  private verify(token: string): RefreshPayload {
    let payload: RefreshPayload;
    try {
      payload = this.jwt.verify<RefreshPayload>(token, {
        secret: this.secret(),
      });
    } catch {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }
    // A refresh token and an access token are signed by different secrets, but only when
    // REFRESH_TOKEN_SECRET is actually set — the old system fell back to JWT_SECRET for
    // both, so this check is what stops an access token being replayed as a refresh one.
    if (payload.type !== 'refresh' || !payload.jti || !payload.sub) {
      throw new UnauthorizedException('Refresh token không hợp lệ');
    }
    return payload;
  }

  /** Carries the original user agent across a rotation, as the old code did. */
  private userAgentOf(stored: string): string | undefined {
    try {
      return (JSON.parse(stored) as StoredSession).userAgent ?? undefined;
    } catch {
      return undefined;
    }
  }
}
