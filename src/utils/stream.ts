import { Readable, PassThrough } from 'node:stream';

/**
 * Convert a readable stream to a Buffer
 */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Demultiplex Docker's multiplexed stream (stdout/stderr combined).
 * Docker multiplexes stdout and stderr into a single stream with 8-byte headers:
 *   [type(1 byte)][0][0][0][size(4 bytes big-endian)][payload]
 *   type: 0=stdin, 1=stdout, 2=stderr
 */
export async function demuxDockerStream(stream: Readable): Promise<{ stdout: string; stderr: string }> {
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    stream.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (buffer.length >= 8) {
        const type = buffer[0];
        const size = buffer.readUInt32BE(4);

        if (buffer.length < 8 + size) break; // need more data

        const payload = buffer.subarray(8, 8 + size);
        buffer = buffer.subarray(8 + size);

        if (type === 1) {
          stdoutChunks.push(payload);
        } else if (type === 2) {
          stderrChunks.push(payload);
        }
      }
    });

    stream.on('end', () => {
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    });

    stream.on('error', reject);
  });
}

/**
 * Helper to delay execution
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
