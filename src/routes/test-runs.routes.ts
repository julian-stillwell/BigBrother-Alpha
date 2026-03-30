import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { UploadError, NotFoundError, ConflictError } from '../errors';
import { checkIdempotency } from '../utils/idempotency';
import { streamToBuffer } from '../utils/stream';
import * as installerService from '../services/installer.service';
import * as orchestratorService from '../services/orchestrator.service';
import { CreateTestRunFields } from '../types/api';

// export async function registerTestRunRoutes(app: FastifyInstance): Promise<void> {
export async function _archive_registerTestRunRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/test-runs
   * Upload a .exe and start a sandboxed test run
   */
  app.post('/test-runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const data = await request.file();

    if (!data) {
      throw new UploadError('No file uploaded. Send a multipart form with a "file" field.');
    }

    // Extract form fields
    const fields = data.fields as Record<string, any>;
    const tenantId = fields.tenant_id?.value as string | undefined;
    const softwareId = fields.software_id?.value as string | undefined;
    const sandboxType = (fields.sandbox_type?.value as string) || 'WINE_LINUX';
    const runReason = fields.run_reason?.value as string | undefined;
    const idempotencyKey = fields.idempotency_key?.value as string | undefined;

    // Validate required fields
    if (!tenantId) {
      throw new UploadError('Missing required field: tenant_id');
    }
    if (!softwareId) {
      throw new UploadError('Missing required field: software_id');
    }

    // Check idempotency
    if (idempotencyKey) {
      const existing = await checkIdempotency(idempotencyKey);
      if (existing) {
        return reply.status(409).send({
          id: existing.id,
          status: existing.status,
          created_at: existing.createdAt.toISOString(),
          poll_url: `/api/v1/test-runs/${existing.id}`,
          message: 'Test run already exists for this idempotency key',
        });
      }
    }

    // Read file into buffer
    const fileBuffer = await streamToBuffer(data.file);

    // Validate it's a PE executable
    installerService.validateExecutable(fileBuffer, data.filename);

    // Create the test run record
    const testRun = await prisma.testRun.create({
      data: {
        tenantId,
        softwareId,
        sandboxType: sandboxType as any,
        runReason: runReason || null,
        idempotencyKey: idempotencyKey || null,
      },
    });

    logger.info(
      { testRunId: testRun.id, tenantId, softwareId, fileSize: fileBuffer.length },
      'Test run created, starting orchestration'
    );

    // Fire-and-forget: start the orchestration pipeline asynchronously
    orchestratorService
      .orchestrate(testRun.id, tenantId, fileBuffer)
      .catch((err) => {
        logger.error({ testRunId: testRun.id, err }, 'Orchestration failed unexpectedly');
      });

    // Return immediately with 202 Accepted
    return reply.status(202).send({
      id: testRun.id,
      status: testRun.status,
      created_at: testRun.createdAt.toISOString(),
      poll_url: `/api/v1/test-runs/${testRun.id}`,
    });
  });

  /**
   * GET /api/v1/test-runs
   * List test runs with pagination and filtering
   */
  app.get('/test-runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const page = Math.max(1, parseInt(query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(query.limit || '20', 10)));
    const skip = (page - 1) * limit;

    // Build where clause from filters
    const where: Record<string, any> = {};
    if (query.tenant_id) where.tenantId = query.tenant_id;
    if (query.software_id) where.softwareId = query.software_id;
    if (query.status) where.status = query.status;

    const [total, runs] = await Promise.all([
      prisma.testRun.count({ where }),
      prisma.testRun.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { artifacts: true },
      }),
    ]);

    return reply.send({
      data: runs.map(formatTestRun),
      pagination: { page, limit, total },
    });
  });

  /**
   * GET /api/v1/test-runs/:id
   * Get full details of a test run including metrics and artifacts
   */
  app.get('/test-runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const testRun = await prisma.testRun.findUnique({
      where: { id },
      include: { artifacts: true },
    });

    if (!testRun) {
      throw new NotFoundError('TestRun', id);
    }

    // If completed, try to load the metrics and file analysis from artifacts
    let metrics = null;
    let fileAnalysis = null;

    if (testRun.status === 'COMPLETED') {
      const metricsArtifact = testRun.artifacts.find(
        (a) => a.artifactType === 'METRICS_REPORT'
      );
      const fileArtifact = testRun.artifacts.find(
        (a) => a.artifactType === 'FILE_DIFF_REPORT'
      );

      if (metricsArtifact) {
        try {
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          const { config } = await import('../config');
          const filePath = path.join(config.ARTIFACT_STORAGE_PATH, metricsArtifact.objectKey);
          const content = await fs.readFile(filePath, 'utf-8');
          metrics = JSON.parse(content);
        } catch {
          // Metrics file not available
        }
      }

      if (fileArtifact) {
        try {
          const fs = await import('node:fs/promises');
          const path = await import('node:path');
          const { config } = await import('../config');
          const filePath = path.join(config.ARTIFACT_STORAGE_PATH, fileArtifact.objectKey);
          const content = await fs.readFile(filePath, 'utf-8');
          fileAnalysis = JSON.parse(content);
        } catch {
          // File analysis not available
        }
      }
    }

    return reply.send({
      ...formatTestRun(testRun),
      metrics,
      file_analysis: fileAnalysis,
    });
  });
}

/**
 * Format a test run for API response
 */
function formatTestRun(run: any) {
  return {
    id: run.id,
    tenant_id: run.tenantId,
    software_id: run.softwareId,
    status: run.status,
    sandbox_type: run.sandboxType,
    run_reason: run.runReason,
    attempt_number: run.attemptNumber,
    idempotency_key: run.idempotencyKey,
    started_at: run.startedAt?.toISOString() || null,
    completed_at: run.completedAt?.toISOString() || null,
    created_at: run.createdAt.toISOString(),
    artifacts: run.artifacts?.map((a: any) => ({
      id: a.id,
      artifact_type: a.artifactType,
      object_key: a.objectKey,
      content_hash: a.contentHash,
      installer_byte_size: a.installerByteSize,
      storage_class: a.storageClass,
      created_at: a.createdAt.toISOString(),
    })),
  };
}
