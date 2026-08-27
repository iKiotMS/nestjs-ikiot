import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import {
  ANNOUNCEMENT_TARGETS,
  AnnouncementTarget,
} from '../system-notification.constants';

const trim = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * `POST /admin/notifications` — an operator writing to shop owners by email.
 *
 * `category` stays free text, as in the old model: it is printed into the subject line and
 * the admin console is the only client, so closing the set here would break it the day a
 * fifth chip is added. See `KNOWN_ANNOUNCEMENT_CATEGORIES` for what the UI sends today.
 */
export class ComposeAnnouncementDto {
  @IsString()
  @trim()
  @IsNotEmpty({ message: 'Tiêu đề là bắt buộc' })
  @MaxLength(200)
  title: string;

  @IsString()
  @trim()
  @IsNotEmpty({ message: 'Nội dung là bắt buộc' })
  @MaxLength(5000)
  description: string;

  @IsString()
  @trim()
  @IsNotEmpty({ message: 'Danh mục là bắt buộc' })
  @MaxLength(100)
  category: string;

  @IsIn(ANNOUNCEMENT_TARGETS, {
    message: `targetType phải là ${ANNOUNCEMENT_TARGETS.join(' hoặc ')}`,
  })
  targetType: string;

  /**
   * Read only when `targetType` is `SELECTION`, and stored only then — an `ALL` announcement
   * that also carried a tenant list would leave a row claiming a narrower audience than it
   * actually had.
   *
   * An empty selection is allowed, exactly as before: it saves the announcement, mails
   * nobody, and says so — the response counts the recipients, so "0 chủ cửa hàng" is the
   * operator's answer rather than a silent success.
   */
  @ValidateIf(
    (dto: ComposeAnnouncementDto) =>
      dto.targetType === AnnouncementTarget.SELECTION,
  )
  @IsArray()
  @IsUUID(undefined, { each: true })
  targetTenants?: string[];
}

export class ListSystemNotificationsDto {
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
  limit: number = 20;
}
