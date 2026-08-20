import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTemplate } from '../../common/audit/audit-descriptor';
import type {
  AuditDescribeContext,
  AuditDescribed,
  AuditDescriptor,
} from '../../common/audit/audit-descriptor';

// Domain-owned audit description for POST /subscription/upgrade/:tenantId (the
// platform-admin direct plan change) — moved out of AuditInterceptor so that file stays
// domain-agnostic. See CLAUDE.md "Audit logging" for the rule.
@Injectable()
@AuditTemplate()
export class SubscriptionAuditTemplate implements AuditDescriptor {
  constructor(private readonly prisma: PrismaService) {}

  matches(path: string): boolean {
    // /subscription/upgrade/:tenantId (this template) vs. /subscription/upgrade/initiate
    // (a completely different, tenant-initiated route with a literal "initiate" segment,
    // not a tenantId) — both contain the same "/subscription/upgrade/" substring, so a
    // plain .includes() check here would misfire on the wrong route. Caught by testing
    // the real upgrade/initiate flow end-to-end, not by inspection.
    return (
      path.includes('/subscription/upgrade/') && !path.endsWith('/initiate')
    );
  }

  async describe({
    request,
    path,
    action,
  }: AuditDescribeContext): Promise<AuditDescribed> {
    const rawTenantId = request.params?.tenantId ?? path.split('/').pop();
    const tenantId = Array.isArray(rawTenantId) ? rawTenantId[0] : rawTenantId;

    let resource = `Tenant ID: ${tenantId}`;
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
      });
      if (tenant) resource = `${tenant.name} - ${tenant.phoneNumber ?? 'N/A'}`;
    }

    const body = (request.body ?? {}) as Record<string, unknown>;
    const details =
      action === 'CREATE'
        ? `Nâng cấp gói cước subscription trực tiếp lên gói ${(body.planCode as string) ?? 'N/A'}`
        : `Thao tác gói cước subscription (${(body.planCode as string) ?? 'N/A'})`;

    return { resource, details };
  }
}
