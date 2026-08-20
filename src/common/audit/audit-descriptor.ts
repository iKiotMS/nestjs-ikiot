import { DiscoveryService } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../types/auth-user.type';

export interface AuditDescribeContext {
  request: Request & { user?: AuthUser };
  path: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
}

export interface AuditDescribed {
  resource: string;
  details: string;
}

/**
 * Implement this in the owning domain module (e.g. `subscription.audit-template.ts`)
 * whenever a route needs a friendlier audit description than the generic fallback in
 * AuditInterceptor. See CLAUDE.md "Audit logging" for the rule this exists to enforce:
 * AuditInterceptor itself must never grow route-specific knowledge of any feature module.
 */
export interface AuditDescriptor {
  matches(path: string): boolean;
  describe(ctx: AuditDescribeContext): AuditDescribed | Promise<AuditDescribed>;
}

/**
 * Marks a provider as an AuditDescriptor. AuditInterceptor discovers every class carrying
 * this decorator at startup, so a new template only has to be a provider in its own
 * module — there is no central list to remember to update. (It used to be wired by hand
 * in AppModule's APP_INTERCEPTOR factory, in two places: forgetting either one still
 * compiled and quietly fell back to the generic description.)
 */
export const AuditTemplate = DiscoveryService.createDecorator<void>();
