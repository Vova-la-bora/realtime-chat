import { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (request, reply) => {
    try {
      await app.container.getRoomService().getRepository().getPool().query('SELECT 1');
      await app.container.getPresence().ping();
      // instance показывает, какой из инстансов ответил (удобно проверять балансировку)
      return { status: 'ok', instance: app.container.getInstanceId() };
    } catch (err) {
      request.log.error(err, 'Проверка БД или Redis не прошла');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });
}
