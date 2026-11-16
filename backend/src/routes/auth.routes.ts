import { FastifyInstance } from 'fastify';
import { config } from '../config';
import { AppError } from '../errors';
import { loginSchema, registerSchema } from '../schemas';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await app.container
      .getAuthService()
      .register(body.username, body.email, body.password, body.displayName);
    reply.setCookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 604800,
      secure: config.cookieSecure,
    });
    return reply.status(201).send({ user: result.user, accessToken: result.accessToken });
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await app.container.getAuthService().login(body.email, body.password);
    reply.setCookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 604800,
      secure: config.cookieSecure,
    });
    return reply.send({ user: result.user, accessToken: result.accessToken });
  });

  app.post('/api/auth/refresh', async (request, reply) => {
    const token = request.cookies.refresh_token;
    if (!token) {
      throw new AppError(401, 'invalid_refresh_token', 'Refresh-токен не передан');
    }
    const result = await app.container.getAuthService().refresh(token);
    reply.setCookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 604800,
      secure: config.cookieSecure,
    });
    return reply.send({ user: result.user, accessToken: result.accessToken });
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies.refresh_token;
    if (token) {
      await app.container.getAuthService().logout(token);
    }
    reply.clearCookie('refresh_token', { path: '/api/auth' });
    return reply.status(204).send();
  });
}
