import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import { config } from './config';
import { ServiceContainer } from './container';
import { pool } from './db';
import { AppError } from './errors';
import { createRedis } from './redis';
import { authRoutes } from './routes/auth.routes';
import { healthRoutes } from './routes/health.routes';
import { roomsRoutes } from './routes/rooms.routes';
import { usersRoutes } from './routes/users.routes';
import { ChatGateway } from './ws/chatGateway';

export interface BuildAppOptions {
  // Готовое подключение к Redis (в тестах подставляется ioredis-mock)
  redis?: Redis;
  // Имя инстанса (по умолчанию из INSTANCE_ID): в тестах так запускают два инстанса в одном процессе
  instanceId?: string;
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const instanceId = options.instanceId ?? config.instanceId;
  const app = Fastify({
    logger: { level: config.logLevel, base: { instance: instanceId } },
    genReqId: () => randomUUID(),
    requestIdHeader: 'x-request-id',
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie);

  const redis = options.redis ?? createRedis();
  redis.on('error', (err) => app.log.warn({ err }, 'Ошибка Redis'));
  app.decorate(
    'container',
    new ServiceContainer(pool, redis, instanceId, (err, message) => app.log.warn({ err }, message)),
  );
  app.decorateRequest('userId', 0);
  app.addHook('onClose', async () => {
    await redis.quit().catch(() => undefined);
    // Пул общий для всех инстансов в одном процессе (тесты), закрываем его один раз
    if (!pool.ended) {
      await pool.end();
    }
  });

  // WebSocket на том же HTTP-сервере, путь /ws. При остановке сначала закрываем подключения.
  const gateway = new ChatGateway(app.container, app.log);
  gateway.attach(app.server);
  await app.container.getBus().start();
  app.addHook('preClose', async () => {
    await gateway.shutdown();
  });

  // Единый формат ошибок: { error: { code, message } }
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code, message: error.message } });
    }
    if (error instanceof ZodError) {
      const message = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({ error: { code: 'validation_error', message } });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply
        .status(error.statusCode)
        .send({ error: { code: error.code ?? 'bad_request', message: error.message } });
    }
    request.log.error(error);
    return reply
      .status(500)
      .send({ error: { code: 'internal_error', message: 'Внутренняя ошибка сервера' } });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({ error: { code: 'not_found', message: 'Маршрут не найден' } });
  });

  // Проверка access-токена; добавляет userId в запрос и в логи
  const authenticate = async (request: FastifyRequest): Promise<void> => {
    const header = request.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new AppError(401, 'unauthorized', 'Требуется авторизация');
    }
    const userId = app.container.getAuthService().verifyAccessToken(header.slice(7));
    request.userId = userId;
    request.log = request.log.child({ userId });
  };

  await app.register(authRoutes);
  await app.register(healthRoutes);
  await app.register(async (protectedScope) => {
    protectedScope.addHook('onRequest', authenticate);
    await protectedScope.register(usersRoutes);
    await protectedScope.register(roomsRoutes);
  });

  return app;
}
