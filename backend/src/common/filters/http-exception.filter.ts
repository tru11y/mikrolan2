import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<FastifyReply>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Le serveur a rencontré un problème. Réessayez.';
    let error: unknown = null;
    let errorCode: string | null = null;
    let context: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, unknown>;
        message = (b.message as string) ?? exception.message;
        error = b.issues ?? b.error ?? null;
        errorCode = (b.errorCode as string) ?? null;
        context = b.context as Record<string, unknown> | undefined;
      }
    } else {
      this.logger.error(exception);
      Sentry.captureException(exception);
      errorCode = 'INTERNAL_ERROR';
    }

    void res.status(status).send({
      success: false,
      data: null,
      message,
      error,
      ...(errorCode ? { errorCode } : {}),
      ...(context ? { context } : {}),
    });
  }
}
