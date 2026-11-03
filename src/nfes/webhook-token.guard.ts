import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { requiredEnv } from '../config';

@Injectable()
export class WebhookTokenGuard implements CanActivate {
  private readonly expected = digest(requiredEnv('WEBHOOK_TOKEN'));

  canActivate(context: ExecutionContext): boolean {
    const received = context.switchToHttp().getRequest<Request>().header('x-webhook-token') ?? '';
    if (!timingSafeEqual(digest(received), this.expected)) {
      throw new UnauthorizedException('Invalid webhook token');
    }
    return true;
  }
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
