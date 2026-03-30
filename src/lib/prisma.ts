// In-memory shim for Prisma client after prisma/ has been archived.
// This provides minimal compatibility for the agent API: create/find/update methods
// used by the orchestration pipeline. It stores TestRuns and TestArtifacts in memory.

import { v4 as uuidv4 } from 'uuid';
import { TestRunStatus, ArtifactType } from '../types/enums';

type TestRun = any;
type TestArtifact = any;

const testRuns = new Map<string, TestRun>();
const artifacts = new Map<string, TestArtifact>();

export const prisma = {
  testRun: {
    create: async ({ data }: { data: any }) => {
      const id = uuidv4();
      const now = new Date();
      const tr: any = {
        id,
        tenantId: data.tenantId,
        softwareId: data.softwareId,
        status: data.status || TestRunStatus.PENDING,
        sandboxType: data.sandboxType || 'WINE_LINUX',
        runReason: data.runReason || null,
        attemptNumber: data.attemptNumber || 1,
        idempotencyKey: data.idempotencyKey || null,
        startedAt: data.startedAt || null,
        completedAt: data.completedAt || null,
        createdAt: now,
        updatedAt: now,
        artifacts: [],
      };
      testRuns.set(id, tr);
      return tr;
    },
    findUnique: async ({ where }: { where: any }) => {
      if (where.id) return testRuns.get(where.id) || null;
      if (where.idempotencyKey) {
        for (const tr of testRuns.values()) {
          if (tr.idempotencyKey === where.idempotencyKey) return tr;
        }
      }
      return null;
    },
    findMany: async ({ where, skip = 0, take = 20, orderBy }: { where: any; skip?: number; take?: number; orderBy?: any }) => {
      // Very naive filtering
      let arr = [...testRuns.values()];
      if (where) {
        if (where.tenantId) arr = arr.filter((r) => r.tenantId === where.tenantId);
        if (where.softwareId) arr = arr.filter((r) => r.softwareId === where.softwareId);
        if (where.status) arr = arr.filter((r) => r.status === where.status);
      }
      arr.sort((a, b) => b.createdAt - a.createdAt);
      return arr.slice(skip, skip + take);
    },
    count: async ({ where }: { where: any }) => {
      let arr = [...testRuns.values()];
      if (where) {
        if (where.tenantId) arr = arr.filter((r) => r.tenantId === where.tenantId);
        if (where.softwareId) arr = arr.filter((r) => r.softwareId === where.softwareId);
        if (where.status) arr = arr.filter((r) => r.status === where.status);
      }
      return arr.length;
    },
    update: async ({ where, data }: { where: any; data: any }) => {
      const tr = testRuns.get(where.id);
      if (!tr) throw new Error('TestRun not found');
      Object.assign(tr, data);
      tr.updatedAt = new Date();
      testRuns.set(tr.id, tr);
      return tr;
    },
  },
  testArtifact: {
    create: async ({ data }: { data: any }) => {
      const id = uuidv4();
      const now = new Date();
      const art: any = {
        id,
        tenantId: data.tenantId,
        testRunId: data.testRunId,
        artifactType: data.artifactType,
        objectKey: data.objectKey,
        contentHash: data.contentHash,
        installerByteSize: data.installerByteSize,
        storageClass: data.storageClass,
        createdAt: now,
      };
      artifacts.set(id, art);
      // also add to testRun if present
      const tr = testRuns.get(data.testRunId);
      if (tr) {
        tr.artifacts = tr.artifacts || [];
        tr.artifacts.push(art);
      }
      return art;
    },
    findUnique: async ({ where }: { where: any }) => {
      if (where.id) return artifacts.get(where.id) || null;
      return null;
    },
  },
};

export async function disconnectPrisma() {
  // no-op for shim
}
