import { PartialType } from '@nestjs/swagger';
import { CreatePaysheetDto } from './create-paysheets.dto';

export class UpdatePaysheetDto extends PartialType(CreatePaysheetDto) {}
