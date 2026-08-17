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
 * AuditInterceptor. Register the instance in AppModule's AuditInterceptor factory — see
 * CLAUDE.md "Audit logging" for the rule this exists to enforce: AuditInterceptor itself
 * must never grow route-specific knowledge of any feature module.
 */
export interface AuditDescriptor {
  matches(path: string): boolean;
  describe(ctx: AuditDescribeContext): AuditDescribed | Promise<AuditDescribed>;
}
