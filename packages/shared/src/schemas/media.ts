import { z } from 'zod';

/**
 * Wire shape for the `POST /media/upload-url` endpoint.
 *
 * The flow:
 *   1. Client calls this endpoint with the kind + content-type + byte size it
 *      intends to upload.
 *   2. Server validates the content-type / size against the per-kind allowlist
 *      and issues a presigned PUT URL to Cloudflare R2 with a 5-minute TTL.
 *   3. Client `PUT`s the raw bytes directly to the URL (no multipart).
 *   4. Client then sends a `message:send` (or `POST /chats/:id/messages`) with
 *      the returned `objectKey` as `mediaObjectKey`. The server re-validates the
 *      key matches the per-user prefix before persisting.
 *
 * The API never touches media bytes — saves CPU and scales R2 independently.
 */

export const MediaUploadKindEnum = z.enum(['IMAGE', 'VOICE']);
export type MediaUploadKind = z.infer<typeof MediaUploadKindEnum>;

export const IMAGE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VOICE_CONTENT_TYPES = ['audio/mp4', 'audio/aac', 'audio/m4a'] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];
export type VoiceContentType = (typeof VOICE_CONTENT_TYPES)[number];

/** Hard caps enforced both client- and server-side. */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
export const VOICE_MAX_BYTES = 5 * 1024 * 1024; //  5 MB

export const MediaUploadRequestSchema = z
  .object({
    kind: MediaUploadKindEnum,
    contentType: z.string().min(1).max(64),
    sizeBytes: z.number().int().positive(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'IMAGE') {
      if (!IMAGE_CONTENT_TYPES.includes(v.contentType as ImageContentType)) {
        ctx.addIssue({
          code: 'custom',
          message: `contentType must be one of: ${IMAGE_CONTENT_TYPES.join(', ')}`,
          path: ['contentType'],
        });
      }
      if (v.sizeBytes > IMAGE_MAX_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: `Image exceeds max size (${IMAGE_MAX_BYTES} bytes)`,
          path: ['sizeBytes'],
        });
      }
    } else {
      if (!VOICE_CONTENT_TYPES.includes(v.contentType as VoiceContentType)) {
        ctx.addIssue({
          code: 'custom',
          message: `contentType must be one of: ${VOICE_CONTENT_TYPES.join(', ')}`,
          path: ['contentType'],
        });
      }
      if (v.sizeBytes > VOICE_MAX_BYTES) {
        ctx.addIssue({
          code: 'custom',
          message: `Voice note exceeds max size (${VOICE_MAX_BYTES} bytes)`,
          path: ['sizeBytes'],
        });
      }
    }
  });
export type MediaUploadRequest = z.infer<typeof MediaUploadRequestSchema>;

export const MediaUploadResponseSchema = z.object({
  objectKey: z.string().min(1).max(256),
  uploadUrl: z.string().url(),
  publicUrl: z.string().url(),
  contentType: z.string().min(1).max(64),
  expiresAt: z.string().datetime(),
});
export type MediaUploadResponse = z.infer<typeof MediaUploadResponseSchema>;
