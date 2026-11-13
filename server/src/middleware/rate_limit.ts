import { Context, Next } from 'hono';
import { Env } from '../types';

export async function rateLimitMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  // If native rate limiter binding exists, enforce it by client IP
  if (c.env.RATE_LIMITER) {
    const clientIp = c.req.header('cf-connecting-ip') || 'unknown';
    const { success } = await c.env.RATE_LIMITER.limit({ key: clientIp });
    if (!success) {
      return c.json(
        {
          success: false,
          error: 'Too Many Requests. Maximum 30 requests per minute.'
        },
        429
      );
    }
  }
  await next();
}
