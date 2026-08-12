import { Module } from '@nestjs/common';
import { TenantController } from './tenants.controller';
import { TenantService } from './tenants.service';

@Module({
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
