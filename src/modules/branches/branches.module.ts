import { Module } from '@nestjs/common';
import { BranchController } from './branches.controller';
import { BranchService } from './branches.service';

@Module({
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}
