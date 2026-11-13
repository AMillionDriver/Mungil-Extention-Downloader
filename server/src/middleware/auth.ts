import { Context, Next } from 'hono';

export async function authMiddleware(c: Context, next: Next) {
  const clientHeader = c.req.header('x-mungil-client');
  if (!clientHeader || !clientHeader.startsWith('mungil-extension/')) {
    return c.json(
      {
        success: false,
        error: 'Unauthorized: Missing or invalid x-mungil-client handshake token'
      },
      401
    );
  }
  await next();
}
