import { PartialType } from '@nestjs/mapped-types';
import { CreateSubscriptionInvoiceDto } from './create-subscription-invoices.dto';

export class UpdateSubscriptionInvoiceDto extends PartialType(CreateSubscriptionInvoiceDto) {}
