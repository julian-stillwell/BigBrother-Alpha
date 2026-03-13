import Docker from 'dockerode';
import { docker } from '../lib/docker';
import { logger } from '../lib/logger';
import { config } from '../config';
import { SandboxError } from '../errors';
import { DockerStatsResponse } from '../types/docker-stats';

export interface CreateSandboxOptions {
  testRunId: string;
  memoryLimitBytes?: number;
  cpuCount?: number;
}

/**
 * Create a new sandbox container for a test run
 */
export async function createContainer(options: CreateSandboxOptions): Promise<Docker.Container> {
  const { testRunId, memoryLimitBytes = 2 * 1024 * 1024 * 1024, cpuCount = 2 } = options;

  try {
    const container = await docker.createContainer({
      Image: config.SANDBOX_IMAGE_NAME,
      name: `bigbrother-${testRunId}`,
      Tty: false,
      HostConfig: {
        Memory: memoryLimitBytes,
        NanoCpus: cpuCount * 1e9,
        NetworkMode: 'bridge', // Allow network so we can detect outbound traffic
        SecurityOpt: ['no-new-privileges'],
        AutoRemove: false, // We manage removal ourselves
      },
      Labels: {
        'bigbrother.test-run-id': testRunId,
        'bigbrother.managed': 'true',
      },
    });

    logger.info({ testRunId, containerId: container.id }, 'Sandbox container created');
    return container;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SandboxError(`Failed to create sandbox container: ${msg}`);
  }
}

/**
 * Start a sandbox container
 */
export async function startContainer(container: Docker.Container): Promise<void> {
  try {
    await container.start();
    logger.info({ containerId: container.id }, 'Sandbox container started');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SandboxError(`Failed to start sandbox container: ${msg}`);
  }
}

/**
 * Copy a file into the container as a tar archive
 */
export async function copyFileToContainer(
  container: Docker.Container,
  tarStream: NodeJS.ReadableStream,
  destPath: string
): Promise<void> {
  try {
    await container.putArchive(tarStream, { path: destPath });
    logger.debug({ containerId: container.id, destPath }, 'File copied to container');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SandboxError(`Failed to copy file to container: ${msg}`);
  }
}

/**
 * Execute a command inside the container and return stdout/stderr
 */
export async function execInContainer(
  container: Docker.Container,
  cmd: string[]
): Promise<{ stream: NodeJS.ReadableStream; exec: Docker.Exec }> {
  try {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await exec.start({ Detach: false, Tty: false });
    return { stream, exec };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SandboxError(`Failed to exec in container: ${msg}`);
  }
}

/**
 * Get a single point-in-time stats snapshot from the container
 */
export async function getContainerStats(container: Docker.Container): Promise<DockerStatsResponse> {
  try {
    const stats = await container.stats({ stream: false }) as unknown as DockerStatsResponse;
    return stats;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SandboxError(`Failed to get container stats: ${msg}`);
  }
}

/**
 * Get filesystem changes since container creation (docker diff)
 */
export async function getContainerDiff(
  container: Docker.Container
): Promise<Array<{ Kind: number; Path: string }>> {
  try {
    // docker diff is available on the container but not in @types/dockerode
    const changes = await (container as any).diff();
    return changes || [];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new SandboxError(`Failed to get container diff: ${msg}`);
  }
}

/**
 * Stop and remove a container (best-effort, never throws)
 */
export async function stopAndRemoveContainer(container: Docker.Container): Promise<void> {
  const containerId = container.id;

  try {
    await container.stop({ t: 5 }).catch(() => {
      // Container may already be stopped
    });
    await container.remove({ force: true, v: true });
    logger.info({ containerId }, 'Sandbox container removed');
  } catch (error) {
    logger.warn({ containerId, error }, 'Failed to clean up sandbox container');
  }
}
