import { Readable } from 'node:stream';
import tar from 'tar-stream';
import Docker from 'dockerode';
import { UploadError, TimeoutError } from '../errors';
import { logger } from '../lib/logger';
import { config } from '../config';
import { InstallerResult } from '../types/api';
import * as sandboxService from './sandbox.service';
import { demuxDockerStream } from '../utils/stream';

const PE_MAGIC_BYTES = Buffer.from([0x4d, 0x5a]); // "MZ" — PE executable header

/**
 * Validate that a buffer looks like a PE (.exe) file
 */
export function validateExecutable(buffer: Buffer, filename: string): void {
  if (buffer.length < 2) {
    throw new UploadError('File is too small to be a valid executable');
  }

  if (buffer[0] !== PE_MAGIC_BYTES[0] || buffer[1] !== PE_MAGIC_BYTES[1]) {
    throw new UploadError(
      `File "${filename}" does not appear to be a valid PE executable (missing MZ header)`
    );
  }
}

/**
 * Create a tar archive containing the .exe file.
 * Docker's putArchive API requires tar format.
 */
export function createTarArchive(buffer: Buffer, filename: string): NodeJS.ReadableStream {
  const pack = tar.pack();
  pack.entry({ name: filename }, buffer);
  pack.finalize();
  return pack;
}

/**
 * Copy the .exe installer into the container
 */
export async function copyInstallerToContainer(
  container: Docker.Container,
  installerBuffer: Buffer
): Promise<void> {
  const tarStream = createTarArchive(installerBuffer, 'installer.exe');
  await sandboxService.copyFileToContainer(container, tarStream, '/sandbox');
  logger.info({ containerId: container.id }, 'Installer copied to container');
}

/**
 * Execute the installer inside the container via Wine
 * Returns stdout, stderr, and exit code
 */
export async function executeInstaller(
  container: Docker.Container,
  timeoutMs?: number
): Promise<InstallerResult> {
  const timeout = timeoutMs ?? config.SANDBOX_TIMEOUT_MS;

  const { stream, exec } = await sandboxService.execInContainer(container, [
    'bash',
    '-c',
    'Xvfb :99 -screen 0 1024x768x16 & sleep 1 && wine /sandbox/installer.exe 2>&1; echo "EXIT_CODE:$?"',
  ]);

  // Race between execution and timeout
  const executionPromise = demuxDockerStream(stream as unknown as Readable);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new TimeoutError(`Installer execution timed out after ${timeout}ms`)),
      timeout
    )
  );

  const { stdout, stderr } = await Promise.race([executionPromise, timeoutPromise]);

  // Extract exit code from output
  const exitCodeMatch = stdout.match(/EXIT_CODE:(\d+)/);
  const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : -1;

  // Clean the exit code marker from stdout
  const cleanStdout = stdout.replace(/EXIT_CODE:\d+\n?/, '').trim();

  // Get the exec's inspect to get the real exit code if available
  let realExitCode = exitCode;
  try {
    const inspectData = await exec.inspect();
    if (inspectData.ExitCode !== null && inspectData.ExitCode !== undefined) {
      realExitCode = inspectData.ExitCode;
    }
  } catch {
    // Use parsed exit code as fallback
  }

  logger.info(
    { containerId: container.id, exitCode: realExitCode },
    'Installer execution completed'
  );

  return {
    exitCode: realExitCode,
    stdout: cleanStdout,
    stderr: stderr.trim(),
  };
}
