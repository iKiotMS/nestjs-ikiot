import { PartialType } from '@nestjs/swagger';
import { CreateShiftTemplateDto } from './create-shift-templates.dto';

export class UpdateShiftTemplateDto extends PartialType(
  CreateShiftTemplateDto,
) {}
