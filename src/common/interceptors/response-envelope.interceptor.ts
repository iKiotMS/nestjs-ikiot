import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

/** The shape every route answers with, restored from iKiotMS-BE. */
export interface ResponseEnvelope {
  success: boolean;
  message?: string;
  data?: unknown;
  [key: string]: unknown;
}

/**
 * Puts iKiotMS-BE's `{ success, message?, data }` envelope back on every response.
 *
 * The old Express controllers each wrote it by hand — `res.json({ success: true, message,
 * data })` for a single record, `res.json({ success: true, ...result })` for a paginated
 * list. The first NestJS pass returned raw service results instead, which made the
 * envelope a breaking change against *every* endpoint rather than any one module's
 * problem; CLAUDE.md has listed it as owed since the generated CRUD went in. Doing it in
 * one interceptor is what stops it being written slightly differently thirty-four times.
 *
 * **Three cases, and the merge is the interesting one:**
 *
 *  - Nothing returned (a 204-ish handler) → `{ success: true }`.
 *  - An object that already carries `data` or `success` → **spread, not nested**. That is
 *    what keeps `paginate()`'s `{ data, pagination }` coming back as
 *    `{ success: true, data, pagination }` — the exact shape the old list endpoints sent,
 *    and the reason a client reading `body.data[0]` and `body.pagination.total` needs no
 *    change. It also covers the handlers that already return `{ message, data, … }`
 *    (subscriptions, the leave-balance routes) and the ones returning a bare
 *    `{ success: true }` (`DELETE /inventory/:id`, `DELETE /customers/:id`), which would
 *    otherwise end up as `{ success: true, data: { success: true } }`.
 *  - Anything else — an entity, an array, a primitive → `{ success: true, data: body }`.
 *
 * Spreading the body *after* `success: true` is deliberate: a handler that returns
 * `success: false` (neither webhook does any more, but the shape is legal) keeps its own
 * answer rather than being overwritten with an optimistic one.
 *
 * **Registration order matters.** Nest runs the response half of interceptors in reverse
 * registration order, so this must be provided *before* `AuditInterceptor` in `AppModule`
 * — that way audit's `tap` still sees the raw login body it identifies the actor from, and
 * this wraps afterwards. Swap them and every login writes a blank audit row.
 *
 * The error half of the envelope lives in `AllExceptionsFilter`, which never reaches an
 * interceptor.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor<
  unknown,
  unknown
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    // Handler first, then class — a controller can opt itself out wholesale.
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    return next.handle().pipe(map((body) => this.wrap(body)));
  }

  private wrap(body: unknown): unknown {
    // A file download is a stream, not JSON — wrapping it would corrupt the response.
    if (body instanceof StreamableFile) return body;

    if (body === undefined || body === null) return { success: true };

    if (this.isMergeable(body)) {
      return { success: true, ...body } satisfies ResponseEnvelope;
    }

    return { success: true, data: body } satisfies ResponseEnvelope;
  }

  /**
   * Does this body already speak the envelope's language?
   *
   * Plain objects only: an array has a `data`-shaped meaning of its own, and a Date or a
   * Prisma Decimal would lose its prototype to the spread. Checking the constructor rather
   * than `typeof` is what keeps those out.
   */
  private isMergeable(body: unknown): body is Record<string, unknown> {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return false;
    }
    const proto: unknown = Object.getPrototypeOf(body);
    if (proto !== Object.prototype && proto !== null) return false;
    return 'data' in body || 'success' in body;
  }
}
