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
   * A **manual** discount the cashier typed against this line.
   *
   * Ignored when the order carries `appliedPromotions`: the server prices those itself and
   * overwrites every line with the engine's allocation, so a promotion and a hand-typed
   * line discount can't be mixed on the same sale. See `OrderService.priceOrder`.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Số tiền giảm không được âm' })
  discountAmount?: number;
}

/**
 * A promotion the cashier picked, named by id and nothing else.
 *
 * `promoName` and `discountAmount` used to be accepted here and are gone: what a promotion
 * is called and what it takes off are facts about the promotion, and the server now works
 * both out through the pricing engine. Sending them is harmless — `ValidationPipe`'s
 * `whitelist: true` strips unknown keys — so a client written against the old shape keeps
 * working, it just no longer decides the numbers.
 */
export class AppliedPromotionDto {
  @IsUUID()
  promotionId: string;
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
   *
   * `PROMOTION` is **not accepted from the client**: sending `appliedPromotions` is what
   * makes a sale a promotion sale, and the server then sets both this and `discountValue`
   * from what the engine actually worked out. Asking the client to declare a total it
   * doesn't compute is how the two ended up able to disagree.
   */
  @IsOptional()
  @IsIn(['ORDER'], {
    message:
      'discountType chỉ nhận ORDER — giảm giá khuyến mãi do máy chủ tự tính từ appliedPromotions',
  })
  discountType?: string;

  /** The manual whole-order discount. Only read when `discountType` is `ORDER`. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Giá trị giảm không được âm' })
  discountValue?: number;

  /**
   * The promotions the cashier picked. The server prices them, spreads the discount across
   * the lines and records the total — the client only names them.
   */
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
