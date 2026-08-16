import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { setAdminBypass } from '../context/tenant-context';

@Injectable()
export class AdminBypassInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    setAdminBypass();
    return next.handle();
  }
}
