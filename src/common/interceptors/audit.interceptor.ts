import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  OnModuleInit,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { SystemRole } from '../constants/system-role';
import type { AuthUser } from '../types/auth-user.type';
import type { AuditableLoginResponse } from '../types/login-response.type';
import { AuditTemplate } from '../audit/audit-descriptor';
import type { AuditDescriptor } from '../audit/audit-descriptor';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ACTION_WORDS: Record<string, string> = {
  CREATE: 'Tạo mới',
  UPDATE: 'Cập nhật',
  DELETE: 'Xóa',
};

interface ResolvedActor {
  userId: string;
  tenantId: string | null;
  systemRole: string;
  email: string | null;
  name: string;
}

type AuthedRequest = Request & { user?: AuthUser };

// Ported from iKiotMS-BE's src/middlewares/auditMiddleware.js (a global Express
// middleware there; a global NestInterceptor here — same trigger conditions: mutating
// methods only, skips /webhook, /uploads, and non-login /auth paths). Two deliberate
// departures from the old version:
//   1. Logs every actor except CUSTOMER, not just SUPER_ADMIN/ADMIN — iKiotMS-BE only
//      ever audited platform-admin actions; this app also gives each tenant its own
//      audit trail (see GET /audit-logs in the audit-logs module).
//   2. Route-specific resource/details descriptions (e.g. the old subscription-upgrade
//      special case) live in per-domain `*.audit-template.ts` files implementing
//      AuditDescriptor and marked `@AuditTemplate()`, which this interceptor discovers at
//      startup — this file must never grow route-specific knowledge of any feature module
//      again. See CLAUDE.md "Audit logging".
//
// Also unlike the old version, this doesn't hook res.on('finish') to check a real 2xx
// status code — in Nest, a thrown HttpException makes the handler's observable error out
// instead of emitting a value, so "did `next.handle()` emit" is already an exact proxy
// for "did the request succeed" given every failure path here throws.
@Injectable()
export class AuditInterceptor implements NestInterceptor, OnModuleInit {
  private readonly logger = new Logger(AuditInterceptor.name);
  private descriptors: AuditDescriptor[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly discovery: DiscoveryService,
  ) {}

  /**
   * Collected once at startup rather than injected: every `@AuditTemplate()` provider in
   * the app registers itself just by existing, so adding one never means editing a list
   * over in AppModule.
   */
  onModuleInit(): void {
    this.descriptors = this.discovery
      .getProviders({ metadataKey: AuditTemplate.KEY })
      .map((wrapper) => wrapper.instance as AuditDescriptor)
      .filter((instance): instance is AuditDescriptor => Boolean(instance));
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (!MUTATING_METHODS.has(request.method)) return next.handle();

    const path = request.originalUrl ?? request.url;
    if (
      path.includes('/webhook') ||
      path.includes('/uploads') ||
      (path.includes('/auth') && !path.includes('/login'))
    ) {
      return next.handle();
    }

    const ipAddress = this.resolveIp(request);

    return next.handle().pipe(
      tap((body) => {
        this.record(request, path, ipAddress, body).catch((error: unknown) => {
          this.logger.error(
            'Failed to write audit log',
            error instanceof Error ? error.stack : error,
          );
        });
      }),
    );
  }

  private async record(
    request: AuthedRequest,
    path: string,
    ipAddress: string,
    body: unknown,
  ) {
    const actor = this.resolveActor(request, path, body);
    if (!actor || actor.systemRole === SystemRole.CUSTOMER) return;

    const { action, resource, details } = await this.describe(request, path);

    await this.prisma.auditLog.create({
      data: {
        userId: actor.userId,
        userEmail: actor.email,
        userName: actor.name,
        userRole: actor.systemRole,
        action,
        resource,
        details,
        tenantId: actor.tenantId,
        tenantName: actor.tenantId ? undefined : 'Hệ thống',
        ipAddress,
      },
    });
  }

  /**
   * `request.ip` already is the right answer: Express derives it from X-Forwarded-For
   * only when `trust proxy` is configured (see main.ts), and from the socket otherwise.
   * Reading the header directly — which this used to do — meant any client could pick the
   * IP recorded against their own actions just by sending it.
   */
  private resolveIp(request: Request): string {
    const raw = request.ip ?? request.socket?.remoteAddress ?? '';
    if (!raw) return '127.0.0.1';
    if (raw === '::1') return '127.0.0.1';
    if (raw.startsWith('::ffff:')) return raw.slice(7);
    return raw;
  }

  private resolveActor(
    request: AuthedRequest,
    path: string,
    body: unknown,
  ): ResolvedActor | null {
    if (request.user) {
      return {
        userId: request.user.userId,
        tenantId: request.user.tenantId,
        systemRole: request.user.systemRole,
        email: request.user.email,
        name:
          request.user.displayName ??
          request.user.email ??
          request.user.phoneNumber,
      };
    }

    // /auth/login and /auth/firebase-login are @Public() — JwtStrategy never ran, so
    // request.user isn't set. Resolve the actor from the response body instead (cheaper
    // than iKiotMS-BE's re-query-by-phone/email, since AuthService already returns it).
    if (!path.includes('/login') || !this.isLoginResponse(body)) return null;

    const { user } = body;
    return {
      userId: user.id,
      tenantId: user.tenantId,
      systemRole: user.systemRole,
      email: user.email,
      name: user.profileFirstName
        ? `${user.profileFirstName} ${user.profileLastName ?? ''}`.trim()
        : (user.email ?? user.phoneNumber ?? 'Unknown'),
    };
  }

  /**
   * The one runtime check standing between an untyped response body and AuditableLoginResponse.
   * AuthService declares that same type with `satisfies`, so the two can't drift apart
   * without the build failing — this only has to prove we're looking at a login response
   * at all, not re-validate each field.
   */
  private isLoginResponse(body: unknown): body is AuditableLoginResponse {
    if (!body || typeof body !== 'object' || !('user' in body)) return false;
    const user = body.user;
    return (
      typeof user === 'object' &&
      user !== null &&
      typeof (user as { id?: unknown }).id === 'string'
    );
  }

  private async describe(
    request: AuthedRequest,
    path: string,
  ): Promise<{ action: string; resource: string | null; details: string }> {
    if (path.includes('/login')) {
      return {
        action: 'LOGIN',
        resource: null,
        details: 'Đăng nhập hệ thống thành công',
      };
    }

    const action: 'CREATE' | 'UPDATE' | 'DELETE' =
      request.method === 'POST'
        ? 'CREATE'
        : request.method === 'DELETE'
          ? 'DELETE'
          : 'UPDATE';

    const descriptor = this.descriptors.find((d) => d.matches(path));
    if (descriptor) {
      const described = await descriptor.describe({ request, path, action });
      return { action, ...described };
    }

    // Generic fallback — for /admin/<x>/... routes, use <x> as the resource instead of
    // the unhelpful literal "Admin" every time.
    const requestBody = (request.body ?? {}) as Record<string, unknown>;
    const parts = path.split('/').filter(Boolean);
    const resourceSegment =
      parts[0] === 'admin' && parts.length > 1
        ? parts[1]
        : (parts[0] ?? 'system');
    const resource =
      resourceSegment.charAt(0).toUpperCase() + resourceSegment.slice(1);
    const entityName =
      (requestBody.name as string) || (requestBody.email as string) || '';
    const details = `${ACTION_WORDS[action] ?? action} ${resource}${entityName ? ` (${entityName})` : ''}`;
    return { action, resource, details };
  }
}
