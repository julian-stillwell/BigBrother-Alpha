import Docker from 'dockerode';
import { DockerStatsResponse } from '../types/docker-stats';
import { MetricsSnapshot, MetricsDelta, MetricsReport } from '../types/metrics';
import { MetricsError } from '../errors';
import * as sandboxService from './sandbox.service';
import { logger } from '../lib/logger';

/**
 * Normalize raw Docker stats into our MetricsSnapshot interface
 */
export function normalizeStats(raw: DockerStatsResponse): MetricsSnapshot {
  // CPU: Docker gives cumulative nanoseconds, we compute percentage
  // Formula: (cpu_delta / system_cpu_delta) * num_cpus * 100
  const cpuDelta =
    raw.cpu_stats.cpu_usage.total_usage - raw.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    raw.cpu_stats.system_cpu_usage - raw.precpu_stats.system_cpu_usage;
  const numCpus = raw.cpu_stats.online_cpus || 1;
  const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

  // Memory: subtract inactive_file for "actual" usage (same as `docker stats` CLI)
  const memoryUsage =
    raw.memory_stats.usage - (raw.memory_stats.stats?.inactive_file || 0);
  const memoryLimit = raw.memory_stats.limit;

  // Network: sum across all interfaces
  let rxBytes = 0;
  let txBytes = 0;
  let rxPackets = 0;
  let txPackets = 0;
  if (raw.networks) {
    for (const iface of Object.values(raw.networks)) {
      rxBytes += iface.rx_bytes;
      txBytes += iface.tx_bytes;
      rxPackets += iface.rx_packets;
      txPackets += iface.tx_packets;
    }
  }

  // Block I/O: sum read/write from blkio_stats
  let blockRead = 0;
  let blockWrite = 0;
  if (raw.blkio_stats?.io_service_bytes_recursive) {
    for (const entry of raw.blkio_stats.io_service_bytes_recursive) {
      const op = entry.op.toLowerCase();
      if (op === 'read') blockRead += entry.value;
      if (op === 'write') blockWrite += entry.value;
    }
  }

  return {
    cpuUsagePercent: Math.round(cpuPercent * 100) / 100, // 2 decimal places
    memoryUsageBytes: memoryUsage,
    memoryLimitBytes: memoryLimit,
    networkRxBytes: rxBytes,
    networkTxBytes: txBytes,
    networkRxPackets: rxPackets,
    networkTxPackets: txPackets,
    blockReadBytes: blockRead,
    blockWriteBytes: blockWrite,
    pidCount: raw.pids_stats?.current || 0,
    capturedAt: new Date(raw.read),
  };
}

/**
 * Compute the delta between two metrics snapshots
 */
export function computeDelta(before: MetricsSnapshot, after: MetricsSnapshot): MetricsDelta {
  return {
    cpuUsagePercentChange:
      Math.round((after.cpuUsagePercent - before.cpuUsagePercent) * 100) / 100,
    memoryUsageBytesChange: after.memoryUsageBytes - before.memoryUsageBytes,
    networkRxBytesChange: after.networkRxBytes - before.networkRxBytes,
    networkTxBytesChange: after.networkTxBytes - before.networkTxBytes,
    networkRxPacketsChange: after.networkRxPackets - before.networkRxPackets,
    networkTxPacketsChange: after.networkTxPackets - before.networkTxPackets,
    blockReadBytesChange: after.blockReadBytes - before.blockReadBytes,
    blockWriteBytesChange: after.blockWriteBytes - before.blockWriteBytes,
    pidCountChange: after.pidCount - before.pidCount,
    durationMs: after.capturedAt.getTime() - before.capturedAt.getTime(),
  };
}

/**
 * Capture a metrics snapshot from a running container
 */
export async function captureSnapshot(container: Docker.Container): Promise<MetricsSnapshot> {
  try {
    const rawStats = await sandboxService.getContainerStats(container);
    const snapshot = normalizeStats(rawStats);
    logger.debug(
      { containerId: container.id, cpu: snapshot.cpuUsagePercent, mem: snapshot.memoryUsageBytes },
      'Metrics snapshot captured'
    );
    return snapshot;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new MetricsError(`Failed to capture metrics snapshot: ${msg}`);
  }
}

/**
 * Capture before and after snapshots and compute the full report.
 * This is a convenience method — the orchestrator typically calls
 * captureSnapshot() separately with the install in between.
 */
export function buildReport(before: MetricsSnapshot, after: MetricsSnapshot): MetricsReport {
  return {
    before,
    after,
    delta: computeDelta(before, after),
  };
}
