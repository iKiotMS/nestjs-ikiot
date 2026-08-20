import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Defaults and the 100 ceiling come from iKiotMS-BE's BranchQueryDTO, which every other
// list endpoint there copied. `@Type` is required because query strings arrive as strings
// even with the global ValidationPipe's `transform: true`.
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
