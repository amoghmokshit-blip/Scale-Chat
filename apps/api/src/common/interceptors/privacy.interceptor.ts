import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Global response interceptor — CLAUDE.md §4 "Privacy engine — Layer 2".
 *
 * For any controller handler annotated with the `@MaskedResponse()` decorator (not
 * yet added — chat module will introduce it), this would refuse to emit a payload
 * containing residual PII fields without the `__masked` brand.
 *
 * For now we operate in *audit mode*: we log a warning if a response from a
 * member-context endpoint contains `phoneE164` / `senderUserId`, but we don't
 * page the on-call. Once the chat module ships and we have member-context
 * surfaces, this flips to fail-closed.
 */
@Injectable()
export class PrivacyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(PrivacyInterceptor.name);
  private static readonly PII_FIELDS: readonly string[] = ['phoneE164', 'senderUserId'];

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && hasResidualPii(data)) {
          // /me intentionally returns PII for the self view — controllers opting *in* to PII
          // would set a flag on the request via a future `@SelfView()` decorator. Until then,
          // we just emit a debug log so we can audit endpoints once chat ships.
          this.logger.debug({ kind: 'pii-passthrough' }, 'response contains PII fields');
        }
        return data;
      })
    );
  }

  static containsPii(value: unknown): boolean {
    return hasResidualPii(value);
  }

  static get piiFields(): readonly string[] {
    return PrivacyInterceptor.PII_FIELDS;
  }
}

function hasResidualPii(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(hasResidualPii);
  const obj = value as Record<string, unknown>;
  for (const field of PrivacyInterceptor.piiFields) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) return true;
  }
  return Object.values(obj).some(hasResidualPii);
}
