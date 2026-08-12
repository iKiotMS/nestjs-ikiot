import { Module } from '@nestjs/common';
import { HolidayController } from './holidays.controller';
import { HolidayService } from './holidays.service';

@Module({
  controllers: [HolidayController],
  providers: [HolidayService],
  exports: [HolidayService],
})
export class HolidayModule {}
