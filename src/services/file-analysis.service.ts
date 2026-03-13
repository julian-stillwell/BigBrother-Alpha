import path from 'node:path';
import Docker from 'dockerode';
import { Readable } from 'node:stream';
import { FileChange, FileAnalysisResult } from '../types/api';
import * as sandboxService from './sandbox.service';
import { demuxDockerStream } from '../utils/stream';
import { logger } from '../lib/logger';

/**
 * Configurable list of directories that an installer should NOT touch.
 * Writes to these paths are flagged as suspicious.
 */
const BANNED_DIRECTORIES = [
  '/etc/systemd',
  '/etc/cron.d',
  '/etc/cron.daily',
  '/etc/cron.hourly',
  '/etc/crontab',
  '/usr/sbin',
  '/boot',
  '/root/.ssh',
  '/home/sandboxuser/.ssh',
  '/etc/sudoers',
  '/etc/sudoers.d',
  '/etc/init.d',
  '/etc/rc.d',
];

/**
 * Map Docker diff Kind codes to human-readable strings
 */
function mapDiffKind(kind: number): 'Changed' | 'Added' | 'Deleted' {
  switch (kind) {
    case 0:
      return 'Changed';
    case 1:
      return 'Added';
    case 2:
      return 'Deleted';
    default:
      return 'Changed';
  }
}

/**
 * Analyze the filesystem changes in a container after installer execution.
 * Uses `docker diff` and optionally `du` for disk footprint.
 */
export async function analyzeFilesystem(
  container: Docker.Container
): Promise<FileAnalysisResult> {
  // 1. Get all filesystem changes via docker diff
  const rawChanges = await sandboxService.getContainerDiff(container);

  const changes: FileChange[] = rawChanges.map((c) => ({
    kind: mapDiffKind(c.Kind),
    path: c.Path,
  }));

  // 2. Categorize
  const added = changes.filter((c) => c.kind === 'Added');
  const changed = changes.filter((c) => c.kind === 'Changed');
  const deleted = changes.filter((c) => c.kind === 'Deleted');

  // 3. Extract unique parent directories touched
  const directoriesTouched = [...new Set(changes.map((c) => path.dirname(c.path)))].sort();

  // 4. Check for banned directory violations
  const bannedDirectoryViolations = changes
    .filter((c) => BANNED_DIRECTORIES.some((banned) => c.path.startsWith(banned)))
    .map((c) => c.path);

  if (bannedDirectoryViolations.length > 0) {
    logger.warn(
      { containerId: container.id, violations: bannedDirectoryViolations },
      'Installer touched banned directories!'
    );
  }

  // 5. Estimate disk footprint of added files
  let estimatedDiskFootprintBytes = 0;
  if (added.length > 0) {
    try {
      estimatedDiskFootprintBytes = await estimateDiskFootprint(container, added);
    } catch (error) {
      logger.warn(
        { containerId: container.id, error },
        'Failed to estimate disk footprint, defaulting to 0'
      );
    }
  }

  logger.info(
    {
      containerId: container.id,
      added: added.length,
      changed: changed.length,
      deleted: deleted.length,
      bannedViolations: bannedDirectoryViolations.length,
      footprintBytes: estimatedDiskFootprintBytes,
    },
    'Filesystem analysis complete'
  );

  return {
    totalFilesAdded: added.length,
    totalFilesChanged: changed.length,
    totalFilesDeleted: deleted.length,
    directoriesTouched,
    bannedDirectoryViolations,
    estimatedDiskFootprintBytes,
    changes,
  };
}

/**
 * Estimate the total disk size of added files using `du` inside the container.
 * Falls back to counting files if `du` fails.
 */
async function estimateDiskFootprint(
  container: Docker.Container,
  addedFiles: FileChange[]
): Promise<number> {
  // Use du on the root to get total, but limit to added paths
  // For efficiency, pick top-level unique directories of added files
  const addedDirs = [...new Set(addedFiles.map((f) => path.dirname(f.path)))];

  // Limit to top 50 directories to avoid command-line length issues
  const dirsToCheck = addedDirs.slice(0, 50);

  if (dirsToCheck.length === 0) return 0;

  try {
    const { stream } = await sandboxService.execInContainer(container, [
      'du',
      '-sb',
      '--total',
      ...dirsToCheck,
    ]);

    const { stdout } = await demuxDockerStream(stream as unknown as Readable);

    // Parse du output — last line is "total"
    const lines = stdout.trim().split('\n');
    const totalLine = lines.find((line) => line.includes('total'));
    if (totalLine) {
      const bytes = parseInt(totalLine.split('\t')[0], 10);
      return isNaN(bytes) ? 0 : bytes;
    }

    // If no total line, sum all entries
    let total = 0;
    for (const line of lines) {
      const bytes = parseInt(line.split('\t')[0], 10);
      if (!isNaN(bytes)) total += bytes;
    }
    return total;
  } catch {
    // If du fails, return a rough estimate: file_count * avg_file_size
    return addedFiles.length * 4096; // Rough estimate: 4KB per file
  }
}
