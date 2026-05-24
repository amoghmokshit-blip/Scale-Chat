import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  MediaUploadRequestSchema,
  type MediaUploadRequest,
  type MediaUploadResponse,
} from '@scalechat/shared';

import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import type { AccessTokenPayload } from '../../common/auth/jwt.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RateLimitService } from '../../common/rate-limit/rate-limit.service';
import { MediaService } from './media.service';

const UPLOAD_URL_LIMIT_PER_MIN = 30;
const UPLOAD_URL_WINDOW_MS = 60_000;

@UseGuards(JwtAuthGuard)
@Controller('media')
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly rateLimit: RateLimitService,
  ) {}

  /**
   * Issue a presigned PUT URL for the client to upload media bytes directly to
   * R2. Rate-limited to 30 calls / minute / user so a malicious client can't
   * burn quota generating unused URLs.
   */
  @Post('upload-url')
  @HttpCode(200)
  async createUploadUrl(
    @CurrentUser() user: AccessTokenPayload,
    @Body(new ZodValidationPipe(MediaUploadRequestSchema)) body: MediaUploadRequest,
  ): Promise<MediaUploadResponse> {
    const result = await this.rateLimit.consume(
      `media:upload-url:${user.sub}`,
      UPLOAD_URL_LIMIT_PER_MIN,
      UPLOAD_URL_WINDOW_MS,
    );
    if (!result.allowed) {
      throw new HttpException(
        {
          code: 'rate_limited',
          message: 'Too many upload-url requests. Try again shortly.',
          resetInMs: result.resetInMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return this.media.presignUpload({
      userId: user.sub,
      kind: body.kind,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });
  }
}
