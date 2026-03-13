import Docker from 'dockerode';

export const docker = new Docker();

/**
 * Verify Docker daemon is reachable
 */
export async function verifyDockerConnection(): Promise<void> {
  try {
    await docker.ping();
  } catch (error) {
    throw new Error(
      `Cannot connect to Docker daemon. Is Docker running? ${error instanceof Error ? error.message : error}`
    );
  }
}
