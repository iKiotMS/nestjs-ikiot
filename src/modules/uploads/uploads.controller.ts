import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { MAX_UPLOAD_BYTES, UploadService } from './uploads.service';

/**
 * `POST /uploads` — ported from iKiotMS-BE's upload module.
 *
 * Authenticated but **not permission-gated**, matching the old route (`verifyJwt` with no
 * `authorize()` call): the URL it returns is only useful once written onto a product,
 * a profile or a ticket, and each of those writes is gated on its own resource.
 *
 * The multer field is `file`, as the old `upload.single("file")` had it.
 */
@ApiTags('uploads')
@ApiBearerAuth('bearer')
@Controller('uploads')
export class UploadController {
  constructor(private readonly service: UploadService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  // The limit is enforced twice on purpose: multer stops reading a huge body off the
  // socket, and the service re-checks so the caller gets a Vietnamese 400 rather than
  // multer's own error shape.
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  upload(@UploadedFile() file?: Express.Multer.File) {
    return this.service.upload(file);
  }
}
