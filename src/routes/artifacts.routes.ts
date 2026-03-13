import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import * as artifactService from '../services/artifact.service';

export async function registerArtifactRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/artifacts/:id
   * Get artifact metadata
   */
  app.get('/artifacts/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const artifact = await artifactService.getArtifact(id);

    return reply.send({
      id: artifact.id,
      test_run_id: artifact.testRunId,
      artifact_type: artifact.artifactType,
      object_key: artifact.objectKey,
      content_hash: artifact.contentHash,
      installer_byte_size: artifact.installerByteSize,
      storage_class: artifact.storageClass,
      created_at: artifact.createdAt.toISOString(),
    });
  });

  /**
   * GET /api/v1/artifacts/:id/download
   * Stream-download the artifact file
   */
  app.get('/artifacts/:id/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { stream, filename, size } = await artifactService.streamArtifact(id);

    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    reply.header('Content-Type', 'application/octet-stream');
    reply.header('Content-Length', size);

    return reply.send(stream);
  });
}
