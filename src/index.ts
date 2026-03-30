import Fastify, { FastifyError } from 'fastify';
import multipart from '@fastify/multipart';
import cors from '@fastify/cors';
import { config } from './config';
import { prisma, disconnectPrisma } from './lib/prisma';
import { verifyDockerConnection } from './lib/docker';
import { logger } from './lib/logger';
import { AppError } from './errors';
import { registerRoutes } from './routes';

async function main() {
  // NOTE: keep main for backwards compatibility when running as standalone service.
  // The agent engine is now exposed via src/agent and can be used programmatically.

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
  });

  // --- Plugins ---
  await app.register(cors, { origin: true });
  await app.register(multipart, {
    limits: {
      fileSize: config.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
    },
  });

  // --- Global error handler ---
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
    }

    // Fastify validation error
    if (error.validation) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: error.message,
      });
    }

    // Unexpected error — don't leak internals
    app.log.error({ error: error.message, stack: error.stack }, 'Unhandled error');
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  // --- Routes ---
  await registerRoutes(app);

  // --- Startup checks ---
  try {
    await prisma.$connect();
    app.log.info('Database connected');
  } catch (err) {
    app.log.error({ err }, 'Failed to connect to database');
    process.exit(1);
  }

  try {
    await verifyDockerConnection();
    app.log.info('Docker daemon connected');
  } catch (err) {
    app.log.warn({ err }, 'Docker daemon not available — sandbox features will fail');
  }

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down gracefully...`);
    await app.close();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // --- Start server ---
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`BigBrother API running on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
