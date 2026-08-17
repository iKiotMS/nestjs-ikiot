import { PartialType } from '@nestjs/mapped-types';
import { CreateShiftTemplateDto } from './create-shift-templates.dto';

export class UpdateShiftTemplateDto extends PartialType(
  CreateShiftTemplateDto,
) {}
