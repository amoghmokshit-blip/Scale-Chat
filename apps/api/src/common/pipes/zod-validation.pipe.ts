import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodTypeAny } from 'zod';

/**
 * Validates an incoming body / query / param against a zod schema and returns the
 * *parsed* value (with coercions applied) downstream. Errors come back as a 400
 * with the standard NestJS `BadRequestException` payload — but with our own
 * `code: 'validation_failed'` discriminator so the mobile client can branch on it
 * without parsing the message string.
 */
@Injectable()
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly schema: T) {}

  transform(value: unknown): unknown {
    try {
      return this.schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        throw new BadRequestException({
          code: 'validation_failed',
          message: 'Request validation failed',
          issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      throw err;
    }
  }
}
