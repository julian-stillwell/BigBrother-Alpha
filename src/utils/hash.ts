import crypto from 'node:crypto';

/**
 * Compute SHA-256 hash of a buffer
 */
export function computeSha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Compute SHA-256 hash with a "sha256:" prefix
 */
export function computeSha256Prefixed(data: Buffer): string {
  return `sha256:${computeSha256(data)}`;
}
