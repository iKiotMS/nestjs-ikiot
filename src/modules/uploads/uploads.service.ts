import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import type { UploadApiResponse } from 'cloudinary';

/** Folder, formats and size limit ported verbatim from iKiotMS-BE's UploadController. */
export const UPLOAD_FOLDER = 'ikiot_uploads';
export const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Set(ALLOWED_FORMATS.map((f) => `image/${f}`));

/**
 * Image uploads, to Cloudinary — a port of iKiotMS-BE's `upload` module.
 *
 * That module wired `multer-storage-cloudinary` into the route so the file went straight
 * from the request to Cloudinary and `req.file.path` came back as the URL. Here the file
 * arrives in memory (`FileInterceptor` with multer's default memory storage) and is piped
 * up with `upload_stream`. Same folder, same formats, same 5MB ceiling, same
 * `{ url }` response — one fewer dependency, and the validation happens somewhere it can
 * return a real 400 rather than a multer error.
 *
 * **Nothing is uploaded when Cloudinary is unconfigured.** The old module called
 * `cloudinary.config()` at import time with whatever was in the environment, so a missing
 * key surfaced as a 500 on the first upload. This says so plainly instead.
 */
@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  private configured = false;

  private configure(): boolean {
    if (this.configured) return true;
    const {
      CLOUDINARY_CLOUD_NAME: cloud_name,
      CLOUDINARY_API_KEY: api_key,
      CLOUDINARY_API_SECRET: api_secret,
    } = process.env;
    if (!cloud_name || !api_key || !api_secret) return false;

    cloudinary.config({ cloud_name, api_key, api_secret });
    this.configured = true;
    return true;
  }

  async upload(file?: Express.Multer.File): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('Chưa chọn tệp để tải lên');
    }
    if (!ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `Định dạng không được hỗ trợ. Chỉ nhận: ${ALLOWED_FORMATS.join(', ')}`,
      );
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException('Tệp vượt quá giới hạn 5MB');
    }
    if (!this.configure()) {
      throw new InternalServerErrorException(
        'Dịch vụ lưu trữ ảnh chưa được cấu hình trên máy chủ',
      );
    }

    const result = await new Promise<UploadApiResponse>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: UPLOAD_FOLDER, resource_type: 'image' },
        (error, uploaded) => {
          if (error || !uploaded) {
            reject(error instanceof Error ? error : new Error('Upload failed'));
            return;
          }
          resolve(uploaded);
        },
      );
      stream.end(file.buffer);
    }).catch((error: unknown) => {
      this.logger.error(
        'Cloudinary upload failed',
        error instanceof Error ? error.stack : error,
      );
      throw new InternalServerErrorException('Tải tệp lên thất bại');
    });

    // `secure_url` is the https one; the old module returned multer-storage-cloudinary's
    // `req.file.path`, which is the same value.
    return { url: result.secure_url };
  }
}
