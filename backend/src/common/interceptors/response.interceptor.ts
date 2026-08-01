import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { NO_ENVELOPE_KEY } from '../decorators/no-envelope.decorator';

export interface ApiResponse<T> {
  success: true;
  data: T;
  message: string | null;
  error: null;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiResponse<T> | T> {
    // Un flux SSE émet un message par évènement : les emballer un par un
    // produisait un flux illisible côté client.
    const raw = this.reflector.getAllAndOverride<boolean>(NO_ENVELOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        message: null,
        error: null,
      })),
    );
  }
}
