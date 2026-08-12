import { Module } from '@nestjs/common';
import { WorkingScheduleController } from './working-schedules.controller';
import { WorkingScheduleService } from './working-schedules.service';

@Module({
  controllers: [WorkingScheduleController],
  providers: [WorkingScheduleService],
  exports: [WorkingScheduleService],
})
export class WorkingScheduleModule {}
