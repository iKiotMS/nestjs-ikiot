import { Module } from '@nestjs/common';
import { UserController } from './users.controller';
import { UserService } from './users.service';
import { NotificationModule } from '../notifications/notifications.module';

@Module({
  // NotificationModule: activating a staff login tells the employee about it.
  imports: [NotificationModule],
  controllers: [UserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
