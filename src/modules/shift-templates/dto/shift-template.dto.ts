import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { SHIFT_TIME_MESSAGE } from '../shift-time';

const trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * Ported from `ShiftTemplateDTO`. Create and update take the same body — the old service
 * ran both through one DTO and `$set` the whole thing, so a PATCH here replaces every
 * field rather than merging.
 *
 * **`endTime` before `startTime` is allowed**, and deliberately: the old DTO had that
 * check written and commented out with `IGNORE END TIME MUST BE AFTER START TIME`. A
 * night shift is 22:00–06:00, and `WorkingScheduleService` reads exactly that case to
 * roll `endAt` onto the next day.
 */
export class ShiftTemplateDto {
  @IsString()
  @trim()
  @IsNotEmpty({ message: 'Tên ca mẫu là bắt buộc' })
  name: string;

  @IsString()
  @trim()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: `Giờ bắt đầu: ${SHIFT_TIME_MESSAGE}`,
  })
  startTime: string;

  @IsString()
  @trim()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: `Giờ kết thúc: ${SHIFT_TIME_MESSAGE}`,
  })
  endTime: string;
}

export class QueryShiftTemplateDto extends PaginationQueryDto {
  /** Partial, case-insensitive match on the template's name. */
  @IsOptional()
  @IsString()
  @trim()
  name?: string;
}
