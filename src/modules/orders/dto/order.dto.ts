import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PAYMENT_METHODS } from '../../../common/constants/payment-method';
import {
  OFFLINE_PAYMENT_METHODS,
  ORDER_STATUSES,
  SETTABLE_ORDER_STATUSES,
} from '../order.constants';

export class OrderItemDto {
  @IsUUID()
  productItemId: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1, { message: 'Số lượng phải từ 1 trở lên' })
  quantity: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Đơn giá không được âm' })
  unitPrice: number;

  /**
   * What comes off this line. For a promotion this is the per-item allocation
   * `POST /promotions/calculate` returned — the server recomputes the order total from
   * these, so sending back what the preview said is what makes the two agree.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Số tiền giảm không được âm' })
  discountAmount?: number;
}

/** What the till sends when a sale is rung up. */
export class AppliedPromotionDto {
  @IsUUID()
  promotionId: string;

  @IsOptional()
  @IsString()
  promoName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountAmount?: number;
}

/**
 * Ported from iKiotMS-BE's CreateOrderDTO, with one field deliberately removed:
 * **`grandTotal` is no longer accepted.** The old API took the total from the client and
 * stored it, so a crafted request could ring up a full basket for zero. It is computed
 * from the lines now — see `OrderService.create`.
 *
 * `status`, `change` and `paymentReference` are absent for the same reason they always
 * should have been: the first is the state machine's, the second is arithmetic, the third
 * is minted by the server.
 */
export class CreateOrderDto {
  @IsUUID()
  branchId: string;

  /** Omitted = the walk-in customer, created once per tenant on first use. */
  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsIn(PAYMENT_METHODS, {
    message: `paymentMethod phải là ${PAYMENT_METHODS.join(', ')}`,
  })
  paymentMethod: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Đơn hàng phải có ít nhất một mặt hàng' })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  /** Cash tendered. Only meaningful for CASH; the change is worked out from it. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  customerPay?: number;

  @IsOptional()
  @IsString()
  note?: string;

  /**
   * `ORDER` = a manual, whole-order discount the cashier typed in (`discountValue`).
   * `PROMOTION` = the discount came from the promotion engine and is already spread across
   * the lines, so `discountValue` is a record of the total rather than a second deduction.
   */
  @IsOptional()
  @IsIn(['ORDER', 'PROMOTION'], {
    message: 'discountType phải là ORDER hoặc PROMOTION',
  })
  discountType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Giá trị giảm không được âm' })
  discountValue?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppliedPromotionDto)
  appliedPromotions?: AppliedPromotionDto[];
}

/** Ported from OrderQueryDTO. */
export class QueryOrderDto extends PaginationQueryDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  /** Partial, case-insensitive match on the customer's name or phone. */
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  search?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;
}

/** Ported from UpdateOrderStatusDTO. */
export class UpdateOrderStatusDto {
  @IsIn(SETTABLE_ORDER_STATUSES, {
    message: `status phải là ${SETTABLE_ORDER_STATUSES.join(', ')}`,
  })
  status: string;
}

/**
 * Ported from PayOfflineOrderDTO — settles a SePay order the customer ended up paying
 * some other way (the transfer failed, they pulled out cash instead).
 */
export class PayOfflineOrderDto {
  @IsOptional()
  @IsIn(OFFLINE_PAYMENT_METHODS, {
    message: `paymentMethod phải là ${OFFLINE_PAYMENT_METHODS.join(', ')}`,
  })
  paymentMethod?: string = 'CASH';

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Số tiền khách đưa không được âm' })
  customerPay?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
