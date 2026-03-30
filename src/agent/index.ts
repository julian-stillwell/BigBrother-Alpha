import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import * as orchestrator from '../services/orchestrator.service';

/**
 * Programmatic agent engine API
 * - startTestRun: create a TestRun record and start orchestration (fire-and-forget)
 * - orchestrateDirect: call the orchestrator for an existing TestRun id
 */

export async function startTestRun(options: {
  tenantId: string;
  softwareId: string;
  sandboxType?: string;
  runReason?: string;
  idempotencyKey?: string;
  installerBuffer: Buffer;
}) {
  const {
    tenantId,
    softwareId,
    sandboxType = 'WINE_LINUX',
    runReason,
    idempotencyKey,
    installerBuffer,
  } = options;

  const testRun = await prisma.testRun.create({
    data: {
      tenantId,
      softwareId,
      sandboxType: sandboxType as any,
      runReason: runReason || null,
      idempotencyKey: idempotencyKey || null,
    },
  });

  logger.info({ testRunId: testRun.id, tenantId, softwareId }, 'Agent: Test run created, starting orchestration');

  // Fire-and-forget orchestration
  orchestrator.orchestrate(testRun.id, tenantId, installerBuffer).catch((err) => {
    logger.error({ testRunId: testRun.id, err }, 'Agent: Orchestration failed unexpectedly');
  });

  return {
    id: testRun.id,
    status: testRun.status,
    created_at: testRun.createdAt.toISOString(),
  };
}

export async function orchestrateDirect(testRunId: string, tenantId: string, installerBuffer: Buffer) {
  return orchestrator.orchestrate(testRunId, tenantId, installerBuffer);
}
