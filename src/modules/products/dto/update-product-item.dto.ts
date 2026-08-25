import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateProductItemDto } from './product-item.dto';

/**
 * Ported from iKiotMS-BE's UpdateProductItemRequestDTO — every creatable field of a
 * variant except the two that only make sense at creation time:
 *   - `initialStock`: stock moves through sales and stock movements, never through an edit.
 *   - `supplierIds`: attaching a supplier is its own route (POST .../suppliers), so a
 *     PATCH that happens to omit the field can't silently detach every supplier.
 */
export class UpdateProductItemDto extends PartialType(
  OmitType(CreateProductItemDto, ['initialStock', 'supplierIds'] as const),
) {}
