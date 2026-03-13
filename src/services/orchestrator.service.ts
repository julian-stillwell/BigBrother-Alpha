import Docker from 'dockerode';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { TestRunStatus, ArtifactType } from '../types/enums';
import { MetricsReport } from '../types/metrics';
import { FileAnalysisResult } from '../types/api';
import * as sandboxService from './sandbox.service';
import * as installerService from './installer.service';
import * as metricsService from './metrics.service';
import * as fileAnalysisService from './file-analysis.service';
import * as artifactService from './artifact.service';
import { sleep } from '../utils/stream';

/**
 * Update a test run's status in the database
 */
async function updateStatus(
  testRunId: string,
  status: TestRunStatus,
  extra?: Record<string, any>
): Promise<void> {
  await prisma.testRun.update({
    where: { id: testRunId },
    data: {
      status: status as any,
      ...extra,
    },
  });
  logger.info({ testRunId, status }, 'Test run status updated');
}

/**
 * Main orchestration pipeline.
 * Runs asynchronously — the API returns immediately after calling this.
 *
 * Pipeline:
 *   PENDING → PROVISIONING → PRE_METRICS → INSTALLING → POST_METRICS → ANALYZING → COMPLETED
 *   Any failure → FAILED / TIMED_OUT
 *   Always → clean up container
 */
export async function orchestrate(
  testRunId: string,
  tenantId: string,
  installerBuffer: Buffer
): Promise<void> {
  let container: Docker.Container | null = null;

  try {
    // ── PENDING → PROVISIONING ──────────────────────────────────
    await updateStatus(testRunId, TestRunStatus.PROVISIONING, {
      startedAt: new Date(),
    });

    container = await sandboxService.createContainer({ testRunId });
    await sandboxService.startContainer(container);

    // Save the original installer as an artifact
    await artifactService.saveArtifact(
      tenantId,
      testRunId,
      ArtifactType.INSTALLER,
      installerBuffer
    );

    // Copy the .exe into the container
    await installerService.copyInstallerToContainer(container, installerBuffer);

    // ── PROVISIONING → PRE_METRICS ──────────────────────────────
    await updateStatus(testRunId, TestRunStatus.PRE_METRICS);

    // Brief pause to let container stabilize (Wine initialization)
    await sleep(2000);
    const beforeSnapshot = await metricsService.captureSnapshot(container);

    // ── PRE_METRICS → INSTALLING ────────────────────────────────
    await updateStatus(testRunId, TestRunStatus.INSTALLING);

    const installResult = await installerService.executeInstaller(container);

    // Save stdout/stderr as artifacts
    if (installResult.stdout) {
      await artifactService.saveArtifact(
        tenantId,
        testRunId,
        ArtifactType.STDOUT_LOG,
        Buffer.from(installResult.stdout, 'utf-8')
      );
    }
    if (installResult.stderr) {
      await artifactService.saveArtifact(
        tenantId,
        testRunId,
        ArtifactType.STDERR_LOG,
        Buffer.from(installResult.stderr, 'utf-8')
      );
    }

    logger.info(
      { testRunId, exitCode: installResult.exitCode },
      'Installer execution finished'
    );

    // ── INSTALLING → POST_METRICS ───────────────────────────────
    await updateStatus(testRunId, TestRunStatus.POST_METRICS);

    const afterSnapshot = await metricsService.captureSnapshot(container);
    const metricsReport: MetricsReport = metricsService.buildReport(
      beforeSnapshot,
      afterSnapshot
    );

    // Save metrics report artifact
    await artifactService.saveArtifact(
      tenantId,
      testRunId,
      ArtifactType.METRICS_REPORT,
      Buffer.from(JSON.stringify(metricsReport, null, 2), 'utf-8')
    );

    // ── POST_METRICS → ANALYZING ────────────────────────────────
    await updateStatus(testRunId, TestRunStatus.ANALYZING);

    const fileAnalysis: FileAnalysisResult =
      await fileAnalysisService.analyzeFilesystem(container);

    // Save file diff report artifact
    await artifactService.saveArtifact(
      tenantId,
      testRunId,
      ArtifactType.FILE_DIFF_REPORT,
      Buffer.from(JSON.stringify(fileAnalysis, null, 2), 'utf-8')
    );

    // ── ANALYZING → COMPLETED ───────────────────────────────────
    await updateStatus(testRunId, TestRunStatus.COMPLETED, {
      completedAt: new Date(),
    });

    logger.info({ testRunId }, 'Test run completed successfully');
  } catch (error) {
    // ── ANY STATE → FAILED / TIMED_OUT ──────────────────────────
    const isTimeout =
      error instanceof Error && error.constructor.name === 'TimeoutError';

    const failStatus = isTimeout ? TestRunStatus.TIMED_OUT : TestRunStatus.FAILED;
    const errorMsg = error instanceof Error ? error.message : String(error);

    logger.error({ testRunId, error: errorMsg, isTimeout }, 'Orchestration failed');

    try {
      await updateStatus(testRunId, failStatus, {
        completedAt: new Date(),
      });
    } catch (dbErr) {
      logger.error(
        { testRunId, dbErr },
        'Failed to update run status to FAILED'
      );
    }
  } finally {
    // ── ALWAYS: Clean up the container ──────────────────────────
    if (container) {
      await sandboxService.stopAndRemoveContainer(container);
    }
  }
}
