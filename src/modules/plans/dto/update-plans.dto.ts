import { PartialType } from '@nestjs/mapped-types';
import { CreatePlanDto } from './create-plans.dto';

export class UpdatePlanDto extends PartialType(CreatePlanDto) {}
