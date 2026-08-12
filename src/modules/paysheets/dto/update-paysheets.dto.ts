import { PartialType } from '@nestjs/mapped-types';
import { CreatePaysheetDto } from './create-paysheets.dto';

export class UpdatePaysheetDto extends PartialType(CreatePaysheetDto) {}
