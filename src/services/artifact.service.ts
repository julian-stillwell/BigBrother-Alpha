import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { prisma } from '../lib/prisma';
import { config } from '../config';
import { logger } from '../lib/logger';
import { NotFoundError } from '../errors';
import { computeSha256Prefixed } from '../utils/hash';
import { ArtifactType, StorageClass } from '../types/enums';

/**
 * Generate the filesystem path for an artifact
 */
function getArtifactDir(tenantId: string, testRunId: string): string {
  return path.join(config.ARTIFACT_STORAGE_PATH, tenantId, testRunId);
}

/**
 * Generate the object key (relative path) for an artifact
 */
function generateObjectKey(
  tenantId: string,
  testRunId: string,
  artifactType: ArtifactType,
  extension: string = ''
): string {
  const filename = `${artifactType.toLowerCase()}${extension}`;
  return `${tenantId}/${testRunId}/${filename}`;
}

/**
 * Map artifact types to file extensions
 */
function getExtension(artifactType: ArtifactType): string {
  switch (artifactType) {
    case ArtifactType.INSTALLER:
      return '.exe';
    case ArtifactType.METRICS_REPORT:
      return '.json';
    case ArtifactType.FILE_DIFF_REPORT:
      return '.json';
    case ArtifactType.STDOUT_LOG:
      return '.log';
    case ArtifactType.STDERR_LOG:
      return '.log';
    default:
      return '.bin';
  }
}

/**
 * Save an artifact to local filesystem and create a DB record
 */
export async function saveArtifact(
  tenantId: string,
  testRunId: string,
  artifactType: ArtifactType,
  data: Buffer
): Promise<string> {
  const extension = getExtension(artifactType);
  const objectKey = generateObjectKey(tenantId, testRunId, artifactType, extension);
  const dir = getArtifactDir(tenantId, testRunId);
  const filePath = path.join(config.ARTIFACT_STORAGE_PATH, objectKey);

  // Ensure directory exists
  await fs.mkdir(dir, { recursive: true });

  // Write file
  await fs.writeFile(filePath, data);

  // Compute hash
  const contentHash = computeSha256Prefixed(data);

  // Create DB record
  const artifact = await prisma.testArtifact.create({
    data: {
      tenantId,
      testRunId,
      artifactType: artifactType as any, // Prisma enum
      objectKey,
      contentHash,
      installerByteSize: data.length,
      storageClass: StorageClass.LOCAL as any, // Prisma enum
    },
  });

  logger.info(
    { artifactId: artifact.id, testRunId, artifactType, objectKey, sizeBytes: data.length },
    'Artifact saved'
  );

  return artifact.id;
}

/**
 * Get the full filesystem path for an artifact by its object key
 */
export function getArtifactFilePath(objectKey: string): string {
  return path.join(config.ARTIFACT_STORAGE_PATH, objectKey);
}

/**
 * Create a readable stream for downloading an artifact
 */
export async function streamArtifact(artifactId: string): Promise<{
  stream: Readable;
  filename: string;
  size: number;
}> {
  const artifact = await prisma.testArtifact.findUnique({
    where: { id: artifactId },
  });

  if (!artifact) {
    throw new NotFoundError('Artifact', artifactId);
  }

  const filePath = getArtifactFilePath(artifact.objectKey);

  try {
    const stat = await fs.stat(filePath);
    const stream = createReadStream(filePath) as unknown as Readable;
    const filename = path.basename(artifact.objectKey);

    return { stream, filename, size: stat.size };
  } catch (error) {
    throw new NotFoundError('Artifact file', artifact.objectKey);
  }
}

/**
 * Get artifact metadata by ID
 */
export async function getArtifact(artifactId: string) {
  const artifact = await prisma.testArtifact.findUnique({
    where: { id: artifactId },
  });

  if (!artifact) {
    throw new NotFoundError('Artifact', artifactId);
  }

  return artifact;
}
