import { Module } from '@nestjs/common';
import { NotificationController } from './notifications.controller';
import { AdminNotificationController } from './admin-notifications.controller';
import { NotificationService } from './notifications.service';
import { AdminNotificationService } from './admin-notifications.service';
import { EmailModule } from '../../common/email/email.module';

// EmailModule for announcements — the operator console's one write is an email to shop
// owners. NotificationService (fan-out + shop inbox) is exported; the admin half is not,
// because nothing else should be reading the operators' feed.
@Module({
  imports: [EmailModule],
  controllers: [NotificationController, AdminNotificationController],
  providers: [NotificationService, AdminNotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
