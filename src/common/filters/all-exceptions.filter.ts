import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../../../generated/prisma/client';

/**
 * The one place an unhandled error becomes an HTTP response.
 *
 * Nest's built-in filter only understands `HttpException`; anything else — including
 * every Prisma error — comes out as a bare 500 with no useful body. That mattered here
 * because the generated CRUD modules hand raw DTOs straight to Prisma, so the most
 * ordinary user mistakes (a duplicate name, a `parentId` pointing at a deleted row) were
 * being reported as server crashes.
 *
 * `HttpException`s are passed through untouched — the ValidationPipe's
 * `{ statusCode, message: string[], error }` body is what the frontend already parses,
 * and rewriting it here would break every form.
 */
const ERROR_LABELS: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.NOT_FOUND]: 'Not Found',
  [HttpStatus.CONFLICT]: 'Conflict',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).json(exception.getResponse());
      return;
    }

    const translated = this.translatePrismaError(exception);
    if (translated) {
      response.status(translated.statusCode).json(translated);
      return;
    }

    // Anything reaching here is a bug, not a client mistake: log the stack and tell the
    // caller nothing beyond "we broke", so an internal message never leaks out.
    this.logger.error(
      `Unhandled ${request.method} ${request.originalUrl ?? request.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Đã có lỗi xảy ra, vui lòng thử lại sau',
      error: 'Internal Server Error',
    });
  }

  /**
   * Maps the Prisma error codes this app can actually provoke. Codes are documented at
   * prisma.io/docs/reference/api-reference/error-reference — anything not listed keeps
   * falling through to a 500, which is the honest answer for an error we haven't thought
   * about yet.
   */
  private translatePrismaError(
    exception: unknown,
  ): { statusCode: number; message: string; error: string } | null {
    if (exception instanceof Prisma.PrismaClientValidationError) {
      // Wrong shape handed to Prisma — a bad query built from client input.
      return this.body(HttpStatus.BAD_REQUEST, 'Dữ liệu gửi lên không hợp lệ');
    }

    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
      return null;
    }

    switch (exception.code) {
      case 'P2002':
        return this.body(
          HttpStatus.CONFLICT,
          `Giá trị đã tồn tại${this.fieldsOf(exception)}`,
        );
      case 'P2003':
        return this.body(
          HttpStatus.BAD_REQUEST,
          'Dữ liệu liên kết không tồn tại hoặc đang được sử dụng',
        );
      case 'P2025':
        return this.body(
          HttpStatus.NOT_FOUND,
          'Không tìm thấy bản ghi cần thao tác',
        );
      case 'P2000':
        return this.body(
          HttpStatus.BAD_REQUEST,
          'Giá trị vượt quá độ dài cho phép',
        );
      case 'P2011':
        return this.body(HttpStatus.BAD_REQUEST, 'Thiếu trường bắt buộc');
      case 'P2014':
        return this.body(
          HttpStatus.BAD_REQUEST,
          'Thao tác này vi phạm ràng buộc giữa các bảng',
        );
      default:
        return null;
    }
  }

  /** `P2002` carries the column(s) that collided — worth showing, it names the field. */
  private fieldsOf(exception: Prisma.PrismaClientKnownRequestError): string {
    const target = (exception.meta as { target?: unknown } | undefined)?.target;
    if (Array.isArray(target)) return `: ${target.join(', ')}`;
    if (typeof target === 'string') return `: ${target}`;
    return '';
  }

  /** Same three-key shape Nest's own HttpException responses use. */
  private body(statusCode: number, message: string) {
    return { statusCode, message, error: ERROR_LABELS[statusCode] ?? 'Error' };
  }
}
