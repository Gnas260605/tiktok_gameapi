import { config } from './config';
import { buildApp } from './app';

const { port, host, isTest } = config.server;

async function bootstrap() {
  const app = buildApp({}, { logger: !isTest });

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error(err, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    const address = await app.listen({ port, host });
    app.log.info(`TikUser API server is running on ${address}`);
    app.log.info(`Swagger UI documentation available at ${address}/docs`);
    app.log.info(`WebSocket endpoint available at ws://${host}:${port}/ws`);
  } catch (err) {
    app.log.error(err, 'Server failed to start');
    process.exit(1);
  }
}

if (!isTest) {
  bootstrap();
}
