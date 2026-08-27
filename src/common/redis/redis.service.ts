import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createClient } from 'redis';
import type { RedisClientType } from 'redis';

/**
 * The one Redis connection in the app.
 *
 * Ported from iKiotMS-BE's `src/config/redis.js`, including the part that matters most:
 * **Redis being down is never fatal.** That file connected lazily, logged a socket error
 * once instead of on every retry, and left `isReady` false so its consumers (OTP storage,
 * the cache middleware) degraded to in-memory rather than taking the app with them. Same
 * contract here — `isReady()` is what callers branch on, and every method below answers
 * as though the key simply wasn't there when the connection is not up.
 *
 * That is not a hedge, it is the deployment story: OTP codes and refresh tokens are the
 * two things stored here, and a shop being unable to *log in* because a cache is down
 * would be a worse failure than the one it prevents. `RefreshTokenService` documents what
 * is actually lost in that state.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: RedisClientType | null = null;
  private loggedError = false;

  async onModuleInit(): Promise<void> {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.logger.warn(
        'REDIS_URL is not set — refresh tokens and OTP codes fall back to in-memory storage',
      );
      return;
    }

    const client: RedisClientType = createClient({
      url,
      socket: {
        // `rediss://` is the TLS scheme; anything else connects in the clear. Spread
        // rather than `tls: boolean` — the socket options are a discriminated union on
        // that field, so a plain boolean doesn't narrow to either arm.
        ...(url.startsWith('rediss://') ? { tls: true as const } : {}),
        connectTimeout: 10_000,
        // Give up after three tries rather than reconnecting forever: the callers all
        // degrade gracefully, and an endless retry loop just buries the real logs.
        reconnectStrategy: (retries) =>
          retries > 3 ? false : Math.min(retries * 500, 3000),
      },
      pingInterval: 4 * 60 * 1000,
    });

    // Logged once per outage, not once per retry — the old version's `hasPrintedSocketError`
    // flag, which exists because a reconnect loop otherwise floods the log.
    client.on('error', (error: Error) => {
      if (this.loggedError) return;
      this.loggedError = true;
      this.logger.warn(`Redis unavailable: ${error.message}`);
    });
    client.on('ready', () => {
      this.loggedError = false;
      this.logger.log('Redis connected');
    });

    this.client = client;
    try {
      await client.connect();
    } catch (error) {
      this.logger.warn(
        `Redis connection failed, continuing without it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  // Synchronous on purpose: `destroy()` doesn't await, and `quit()` — which does — waits
  // for a reply and hangs process shutdown when the connection is already gone, which is
  // exactly the state a test teardown finds it in.
  onModuleDestroy(): void {
    if (!this.client) return;
    try {
      this.client.destroy();
    } catch {
      // already closed
    }
    this.client = null;
  }

  /** Whether Redis is actually usable right now. Callers branch on this. */
  isReady(): boolean {
    return this.client?.isReady ?? false;
  }

  async get(key: string): Promise<string | null> {
    if (!this.isReady()) return null;
    try {
      return await this.client!.get(key);
    } catch {
      return null;
    }
  }

  /** `ttlSeconds` is required — nothing this app puts in Redis is allowed to live forever. */
  async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (!this.isReady()) return false;
    try {
      await this.client!.set(key, value, { EX: ttlSeconds });
      return true;
    } catch {
      return false;
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.isReady() || keys.length === 0) return;
    try {
      await this.client!.del(keys);
    } catch {
      // nothing to do — the key stays until it expires on its own
    }
  }

  /**
   * Every key under a prefix. Uses SCAN rather than KEYS: KEYS blocks the server for the
   * whole sweep, and this runs on "log this user out everywhere", which happens while
   * people are using the app.
   */
  async keysMatching(pattern: string): Promise<string[]> {
    if (!this.isReady()) return [];
    try {
      const found: string[] = [];
      for await (const key of this.client!.scanIterator({
        MATCH: pattern,
        COUNT: 200,
      })) {
        if (Array.isArray(key)) found.push(...key);
        else found.push(key);
      }
      return found;
    } catch {
      return [];
    }
  }
}
