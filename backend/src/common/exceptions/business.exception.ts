import { HttpException, HttpStatus } from '@nestjs/common';

export interface BusinessErrorPayload {
  errorCode: string;
  message: string;
  context?: Record<string, unknown>;
}

export class BusinessException extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly errorCode: string,
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super({ errorCode, message, context }, status);
  }
}
