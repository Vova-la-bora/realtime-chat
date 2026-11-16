import { buildApp } from './app';
import { config } from './config';

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: config.port, host: config.host });

  // Корректное завершение: закрываем сервер (а вместе с ним пул соединений с БД)
  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Получен сигнал завершения');
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Не удалось запустить сервер', err);
  process.exit(1);
});
