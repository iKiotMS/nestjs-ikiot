import { Module } from '@nestjs/common';
import { UserController } from './users.controller';
import { UserService } from './users.service';
import { NotificationModule } from '../notifications/notifications.module';
import { SubscriptionModule } from '../subscriptions/subscriptions.module';

@Module({
  // NotificationModule: activating a staff login tells the employee about it.
  // SubscriptionModule: hiring consumes a seat, so `create` checks the plan's user quota
  // the same way branches, warehouses and products check theirs.
  imports: [NotificationModule, SubscriptionModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
