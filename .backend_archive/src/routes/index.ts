import { FastifyInstance } from 'fastify';
import { registerTestRunRoutes } from './test-runs.routes';
import { registerArtifactRoutes } from './artifacts.routes';
import { prisma } from '../lib/prisma';
import { docker } from '../lib/docker';

// export async function registerRoutes(app: FastifyInstance): Promise<void> {
export async function _archive_registerRoutes(app: FastifyInstance): Promise<void> {
  // Health check with Docker + DB connectivity
  app.get('/api/v1/health', async (_request, reply) => {
    let dbStatus = 'disconnected';
    let dockerStatus = 'disconnected';

    // Check database
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbStatus = 'connected';
    } catch {
      dbStatus = 'disconnected';
    }

    // Check Docker daemon
    try {
      await docker.ping();
      dockerStatus = 'connected';
    } catch {
      dockerStatus = 'disconnected';
    }

    const isHealthy = dbStatus === 'connected' && dockerStatus === 'connected';

    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'healthy' : 'degraded',
      database: dbStatus,
      docker: dockerStatus,
      uptime_seconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // API routes
  await app.register(registerTestRunRoutes, { prefix: '/api/v1' });
  await app.register(registerArtifactRoutes, { prefix: '/api/v1' });
}
