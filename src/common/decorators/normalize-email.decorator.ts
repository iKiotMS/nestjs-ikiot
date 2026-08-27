import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

/**
 * An email field that is also a **lookup key**: validated, lowercased and trimmed before
 * anything else sees it.
 *
 * `User.email` is how `/auth/firebase-login` resolves an account — it looks the address up
 * as `decoded.email.toLowerCase().trim()`. iKiotMS-BE normalized on the way in
 * (`AuthService.updateProfile` did `String(data.email).toLowerCase().trim()`); the first
 * NestJS pass dropped that, which meant an account saved as `Foo@Bar.com` could never sign
 * in with Google, and the "is this email taken" check missed a row differing only in case.
 *
 * Runs as a `class-transformer` transform, so it happens during `plainToInstance` — before
 * validation, and before the DTO reaches any service. That ordering is the point: every
 * write path stores the same canonical form, so uniqueness checks and lookups agree.
 *
 * Contact-only addresses (a supplier's, a branch's) deliberately don't use this — nothing
 * looks an account up by them, and a human-entered address is left as typed.
 */
export function NormalizeEmail(): PropertyDecorator {
  return applyDecorators(
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.toLowerCase().trim() : value,
    ),
    IsEmail({}, { message: 'Email không hợp lệ' }),
  );
}
