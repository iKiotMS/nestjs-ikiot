import { PartialType } from '@nestjs/mapped-types';
import { CreateSubscriptionDto } from './create-subscriptions.dto';

export class UpdateSubscriptionDto extends PartialType(CreateSubscriptionDto) {}
