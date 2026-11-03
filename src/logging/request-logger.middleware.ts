import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/** A middleware rather than an interceptor, so requests refused by guards are logged too. */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('Http');

  use(request: Request, response: Response, next: NextFunction): void {
    const startedAt = Date.now();
    response.on('finish', () => {
      const entry = {
        event: 'http.request',
        method: request.method,
        path: request.originalUrl,
        status: response.statusCode,
        durationMs: Date.now() - startedAt,
      };
      if (response.statusCode >= 500) {
        this.logger.error(entry);
      } else if (response.statusCode >= 400) {
        this.logger.warn(entry);
      } else {
        this.logger.log(entry);
      }
    });
    next();
  }
}
