import { IsObject, IsString } from 'class-validator';

export class CreateAIChatHistoryDto {
  @IsString()
  title: string;

  @IsObject()
  messages: any;
}
