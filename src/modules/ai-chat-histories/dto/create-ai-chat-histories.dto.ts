import { IsObject, IsString } from 'class-validator';

export class CreateAIChatHistoryDto {
  @IsString()
  tenantId: string;

  @IsString()
  userId: string;

  @IsString()
  title: string;

  @IsObject()
  messages: any;
}
