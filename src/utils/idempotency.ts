import { prisma } from '../lib/prisma';

/**
 * Check if a test run with the given idempotency key already exists.
 * Returns the existing run if found, null otherwise.
 */
export async function checkIdempotency(idempotencyKey: string) {
  if (!idempotencyKey) return null;

  const existingRun = await prisma.testRun.findUnique({
    where: { idempotencyKey },
    include: { artifacts: true },
  });

  return existingRun;
}
