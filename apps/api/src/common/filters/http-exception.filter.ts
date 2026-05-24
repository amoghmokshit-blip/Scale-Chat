import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Global exception filter. Produces a stable error envelope:
 *   { error: { code, message, requestId, issues? } }
 *
 * We mask stack traces in production but include enough breadcrumbs (requestId +
 * code) for the mobile client to display a useful error and the on-call to
 * grep logs.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const req = ctx.getRequest<FastifyRequest>();

    const requestId = (req.headers['x-request-id'] as string | undefined) ?? req.id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const normalised = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      void reply.status(status).send({
        error: {
          code: (normalised.code as string | undefined) ?? statusCode(status),
          message: (normalised.message as string | undefined) ?? exception.message,
          ...(normalised.issues ? { issues: normalised.issues } : {}),
          requestId,
        },
      });
      return;
    }

    this.logger.error({ requestId, err: exception }, 'unhandled exception');
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our end.',
        requestId,
      },
    });
  }
}

function statusCode(status: number): string {
  switch (status) {
    case 400: return 'bad_request';
    case 401: return 'unauthorized';
    case 403: return 'forbidden';
    case 404: return 'not_found';
    case 409: return 'conflict';
    case 422: return 'unprocessable';
    case 429: return 'rate_limited';
    case 501: return 'not_implemented';
    default: return status >= 500 ? 'server_error' : 'error';
  }
}
