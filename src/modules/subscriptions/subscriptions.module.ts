import { Module } from '@nestjs/common';
import { SubscriptionController } from './subscriptions.controller';
import { SubscriptionService } from './subscriptions.service';
import { SepaySubscriptionService } from './sepay-subscription.service';
import { SubscriptionCronService } from './subscription-cron.service';
import { SubscriptionAuditTemplate } from './subscription.audit-template';
import { NotificationModule } from '../notifications/notifications.module';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [NotificationModule, EmailModule],
  controllers: [SubscriptionController],
  providers: [
    SubscriptionService,
    SepaySubscriptionService,
    SubscriptionCronService,
    SubscriptionAuditTemplate,
  ],
  // SubscriptionAuditTemplate is exported so AppModule's AuditInterceptor factory can
  // inject it — see CLAUDE.md "Audit logging" for why AuditInterceptor itself never
  // imports feature modules directly.
  exports: [SubscriptionService, SubscriptionAuditTemplate],
})
export class SubscriptionModule {}
