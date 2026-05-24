import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  type MediaUploadKind,
  type MediaUploadResponse,
  VOICE_CONTENT_TYPES,
  VOICE_MAX_BYTES,
} from '@scalechat/shared';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { Env } from '../../config/env';

const UPLOAD_URL_TTL_SECONDS = 300;
const KEY_PREFIX = 'chat-media';

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/m4a': 'm4a',
};

const VALID_EXTS_BY_KIND: Record<MediaUploadKind, readonly string[]> = {
  IMAGE: ['jpg', 'jpeg', 'png', 'webp'],
  VOICE: ['m4a', 'aac'],
};

/**
 * Cloudflare R2 storage adapter — issues presigned PUT URLs that clients use
 * to upload media bytes directly, never touching the API.
 *
 * The bucket is configured as a public R2 bucket (with an unguessable
 * `chat-media/{userIdFirst8}/{uuid}.{ext}` key layout), so reads happen
 * straight off the CDN without per-request signing.
 *
 * Dev mode: if any R2_* env var is unset, `presignUpload` returns 503 instead
 * of crashing. Lets local devs boot the API without provisioning a bucket.
 */
@Injectable()
export class MediaService {
  private readonly log = new Logger(MediaService.name);
  private readonly s3: S3Client | null;
  private readonly bucket: string | null;
  private readonly publicBase: string | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const endpoint = config.get('R2_ENDPOINT', { infer: true });
    const bucket = config.get('R2_BUCKET', { infer: true });
    const accessKeyId = config.get('R2_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('R2_SECRET_ACCESS_KEY', { infer: true });
    const publicBase = config.get('R2_PUBLIC_BASE_URL', { infer: true });

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !publicBase) {
      this.s3 = null;
      this.bucket = null;
      this.publicBase = null;
      this.log.warn(
        'R2 env vars not set — /media/upload-url will return 503. ' +
          'Set R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BASE_URL.',
      );
      return;
    }

    this.s3 = new S3Client({
      endpoint,
      region: 'auto',
      forcePathStyle: false,
      credentials: { accessKeyId, secretAccessKey },
    });
    this.bucket = bucket;
    // Strip trailing slash so we can always concatenate with `/${key}`.
    this.publicBase = publicBase.replace(/\/+$/, '');
  }

  /** Returns true when R2 is wired up. The controller uses this to early-503. */
  isConfigured(): boolean {
    return this.s3 !== null;
  }

  /**
   * Mint a presigned PUT URL the client can stream raw bytes to. The URL is
   * scoped to a single `objectKey` that encodes the sender's user-id prefix —
   * so when the client later sends a message with that key, we can verify the
   * key belongs to them (see `validateObjectKey`).
   */
  async presignUpload(input: {
    userId: string;
    kind: MediaUploadKind;
    contentType: string;
    sizeBytes: number;
  }): Promise<MediaUploadResponse> {
    if (!this.s3 || !this.bucket || !this.publicBase) {
      throw new ServiceUnavailableException({
        code: 'r2_not_configured',
        message: 'Media uploads are not configured on this environment.',
      });
    }

    this.assertContentTypeAndSize(input.kind, input.contentType, input.sizeBytes);

    const ext = EXT_BY_CONTENT_TYPE[input.contentType];
    if (!ext) {
      throw new BadRequestException({
        code: 'invalid_content_type',
        message: `Unsupported contentType: ${input.contentType}`,
      });
    }

    const objectKey = `${KEY_PREFIX}/${userIdPrefix(input.userId)}/${randomUUID()}.${ext}`;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: input.contentType,
      ContentLength: input.sizeBytes,
    });
    const uploadUrl = await getSignedUrl(this.s3, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });

    // Safe: the early-return above guaranteed publicBase is set.
    const publicUrl = this.publicUrlFor(objectKey) as string;

    return {
      objectKey,
      uploadUrl,
      publicUrl,
      contentType: input.contentType,
      expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1_000).toISOString(),
    };
  }

  /**
   * Verifies an inbound `mediaObjectKey` on a send-message request:
   *   1. Matches `chat-media/{userIdPrefix}/{uuid}.{ext}` exactly.
   *   2. The user-id prefix matches the sender (stops cross-user key reuse).
   *   3. The extension is appropriate for the message kind.
   *
   * Throws `BadRequestException({ code: 'invalid_media_key' })` on any mismatch.
   * Cheap: pure regex + string compare, no Redis / DB round-trip.
   */
  validateObjectKey(input: {
    userId: string;
    objectKey: string;
    kind: MediaUploadKind;
  }): void {
    const match = /^chat-media\/([a-f0-9]{8})\/[a-f0-9-]{36}\.([a-z0-9]+)$/i.exec(input.objectKey);
    if (!match) {
      throw new BadRequestException({
        code: 'invalid_media_key',
        message: 'mediaObjectKey is not in the expected format.',
      });
    }
    const [, keyPrefix, ext] = match;
    if (keyPrefix?.toLowerCase() !== userIdPrefix(input.userId)) {
      throw new BadRequestException({
        code: 'invalid_media_key',
        message: 'mediaObjectKey does not belong to the sender.',
      });
    }
    if (!VALID_EXTS_BY_KIND[input.kind].includes(ext?.toLowerCase() ?? '')) {
      throw new BadRequestException({
        code: 'invalid_media_key',
        message: `mediaObjectKey extension is not allowed for kind=${input.kind}.`,
      });
    }
  }

  /** Compose the CDN URL for a stored object. Returns null if R2 isn't configured. */
  publicUrlFor(objectKey: string | null | undefined): string | null {
    if (!objectKey || !this.publicBase) return null;
    return `${this.publicBase}/${objectKey}`;
  }

  private assertContentTypeAndSize(
    kind: MediaUploadKind,
    contentType: string,
    sizeBytes: number,
  ): void {
    if (kind === 'IMAGE') {
      if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        throw new BadRequestException({
          code: 'invalid_content_type',
          message: `contentType must be one of: ${IMAGE_CONTENT_TYPES.join(', ')}`,
        });
      }
      if (sizeBytes > IMAGE_MAX_BYTES) {
        throw new BadRequestException({
          code: 'file_too_large',
          message: `Image exceeds max size (${IMAGE_MAX_BYTES} bytes).`,
        });
      }
    } else {
      if (!(VOICE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
        throw new BadRequestException({
          code: 'invalid_content_type',
          message: `contentType must be one of: ${VOICE_CONTENT_TYPES.join(', ')}`,
        });
      }
      if (sizeBytes > VOICE_MAX_BYTES) {
        throw new BadRequestException({
          code: 'file_too_large',
          message: `Voice note exceeds max size (${VOICE_MAX_BYTES} bytes).`,
        });
      }
    }
  }
}

/** First 8 hex chars of the userId UUID, lowercase, hyphens stripped. */
function userIdPrefix(userId: string): string {
  return userId.replace(/-/g, '').slice(0, 8).toLowerCase();
}
