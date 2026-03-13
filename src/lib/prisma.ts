import { PrismaClient } from '@prisma/client';
import { config } from '../config';

export const prisma = new PrismaClient({
  log:
    config.LOG_LEVEL === 'debug' || config.LOG_LEVEL === 'trace'
      ? ['query', 'info', 'warn', 'error']
      : ['warn', 'error'],
});

/**
 * Gracefully disconnect Prisma on shutdown
 */
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
