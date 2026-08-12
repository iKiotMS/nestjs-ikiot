import { Module } from '@nestjs/common';
import { PayrollPeriodController } from './payroll-periods.controller';
import { PayrollPeriodService } from './payroll-periods.service';

@Module({
  controllers: [PayrollPeriodController],
  providers: [PayrollPeriodService],
  exports: [PayrollPeriodService],
})
export class PayrollPeriodModule {}
