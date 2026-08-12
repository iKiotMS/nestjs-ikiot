import { Module } from '@nestjs/common';
import { LeaveRequestController } from './leave-requests.controller';
import { LeaveRequestService } from './leave-requests.service';

@Module({
  controllers: [LeaveRequestController],
  providers: [LeaveRequestService],
  exports: [LeaveRequestService],
})
export class LeaveRequestModule {}
