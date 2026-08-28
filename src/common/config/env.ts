import { Logger } from '@nestjs/common';

/**
 * What the server needs before it is allowed to accept traffic.
 *
 * The point is **failing at boot rather than at the first request that needs the value**.
 * Without a token secret, for instance, the app starts happily, serves its healthcheck, gets
 * marked live by the load balancer, and only then dies on the first login — by which time
 * the old release has already been torn down. A missing secret is a deploy that should
 * never have gone green.
 */
const REQUIRED = [['DATABASE_URL', 'Postgres connection string']] as const;

/**
 * The key access tokens are signed and verified with.
 *
 * `ACCESS_TOKEN_SECRET` first, then `JWT_SECRET` — the precedence iKiotMS-BE used
 * (`process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET`) and the reason this
 * function exists at all: the running production environment is configured with the old
 * name, and a port that only read `JWT_SECRET` would deploy green and then reject every
 * login. Resolved in one place so the signer (AuthModule), the verifier (JwtStrategy) and
 * the refresh fallback cannot disagree about which key is in use.
 */
export function accessTokenSecret(): string {
  return (
    process.env.ACCESS_TOKEN_SECRET?.trim() ||
    process.env.JWT_SECRET?.trim() ||
    ''
  );
}

/** Refresh tokens may have their own key; they fall back to the access one, as before. */
export function refreshTokenSecret(): string {
  return process.env.REFRESH_TOKEN_SECRET?.trim() || accessTokenSecret();
}

/**
 * Things the app runs without, degrading in a defined way. Each one is logged at boot so
 * "why are no emails going out" is answered by the startup log rather than by an
 * afternoon of debugging.
 */
const OPTIONAL = [
  [
    'REDIS_URL',
    'refresh tokens and OTP codes fall back to in-memory / no sessions',
  ],
  ['CLOUDINARY_CLOUD_NAME', 'file uploads are disabled'],
  ['MAIL_HOST', 'subscription reminders and announcements are not sent'],
  ['GEMINI_API_KEY', 'the AI assistant answers 503'],
  ['GOOGLE_CALENDAR_API_KEY', 'the holiday sync cron is skipped'],
  ['FIREBASE_PRIVATE_KEY', 'Firebase login is disabled'],
  [
    'SEPAY_WEBHOOK_API_KEY',
    'the subscription payment webhook rejects everything',
  ],
] as const;

/**
 * Which browser origins may call this API — HTTP and Socket.IO alike.
 *
 * `CORS_ORIGIN` is a comma-separated list. `true` means "reflect whatever origin asked",
 * which is right for local dev and refused in production by `validateEnv` below.
 * `FRONTEND_URL` is accepted as a fallback because that is the name already set in the
 * running environment.
 */
export function corsOrigins(): string[] | true {
  const configured =
    process.env.CORS_ORIGIN?.trim() || process.env.FRONTEND_URL?.trim();
  if (!configured) return true;
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Socket.IO wants `*` rather than `true` for "any origin"; otherwise identical. */
export function socketCorsOrigins(): string[] | string {
  const origins = corsOrigins();
  return origins === true ? '*' : origins;
}

/**
 * Called from `bootstrap()` before the Nest app is created.
 *
 * Throws on a missing required variable. In production it also refuses to start with an
 * open CORS policy: `CORS_ORIGIN` unset means "reflect any origin", which combined with
 * `credentials: true` lets any website on the internet make authenticated calls with a
 * visitor's cookies. That is the correct default for local dev and an outright hole in
 * production, and the difference between the two is exactly one environment variable —
 * which is precisely the kind of thing that gets forgotten.
 */
export function validateEnv(logger = new Logger('Env')): void {
  const missing = REQUIRED.filter(([key]) => !process.env[key]?.trim());
  if (missing.length > 0) {
    const detail = missing.map(([key, why]) => `  ${key} — ${why}`).join('\n');
    throw new Error(`Missing required environment variables:\n${detail}`);
  }

  if (!accessTokenSecret()) {
    throw new Error(
      'Set ACCESS_TOKEN_SECRET (or JWT_SECRET) — without it every issued token is signed with an empty key.',
    );
  }

  // Asks the same function the app will use, rather than re-testing the variable: a check
  // that disagreed with the resolver is worse than no check at all.
  if (process.env.NODE_ENV === 'production' && corsOrigins() === true) {
    throw new Error(
      'CORS_ORIGIN (or FRONTEND_URL) must be set in production — with both unset any origin may make credentialed requests.',
    );
  }

  for (const [key, consequence] of OPTIONAL) {
    if (!process.env[key]?.trim()) {
      logger.warn(`${key} is not set — ${consequence}.`);
    }
  }
}
