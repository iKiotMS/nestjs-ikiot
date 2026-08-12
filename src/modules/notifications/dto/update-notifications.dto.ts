import { PartialType } from '@nestjs/mapped-types';
import { CreateNotificationDto } from './create-notifications.dto';

export class UpdateNotificationDto extends PartialType(CreateNotificationDto) {}
