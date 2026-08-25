import { IsUUID } from 'class-validator';
import { LocationRefDto } from '../../../common/dto/location-ref.dto';

/**
 * Ported from iKiotMS-BE's AddProductToLocationDTO. `stock` is deliberately not accepted:
 * a location starts stocking an item at zero, and stock only ever moves through a sale or
 * a stock movement, both of which write a paper trail. The old DTO didn't accept it
 * either — this note is here so nobody "helpfully" adds it.
 */
export class AddProductToLocationDto extends LocationRefDto {
  @IsUUID()
  productItemId: string;
}
