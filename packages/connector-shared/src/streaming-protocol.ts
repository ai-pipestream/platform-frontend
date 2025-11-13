/**
 * Streaming protocol helpers for header/data/footer chunks
 *
 * Protocol:
 *   1. Header chunk: Contains Blob with metadata and S3 storage reference
 *   2. Data chunks: Contains raw file content as bytes
 *   3. Footer chunk: Contains BlobMetadata with final SHA256, size, and S3 ETag
 */

import { create } from '@bufbuild/protobuf';
import { TimestampSchema } from '@bufbuild/protobuf/wkt';
import { StreamingChunkSchema, BlobMetadataSchema, type StreamingChunk, type BlobMetadata } from '@ai-pipestream/grpc-stubs/dist/module/connectors/connector_intake_service_pb';
import { BlobSchema, ChecksumType, FileStorageReferenceSchema, type Blob } from '@ai-pipestream/grpc-stubs/dist/core/pipeline_core_types_pb';
import { createHash } from 'crypto';

// Configuration
export const DEFAULT_CHUNK_SIZE = parseInt(process.env.GRPC_CHUNK_SIZE || '10485760'); // 10MB default

/**
 * File metadata for streaming
 */
export interface FileMetadata {
  filename: string;
  path: string;
  mimeType: string;
  sizeBytes: bigint;
  sourceCreated?: Date;
  sourceModified?: Date;
  sourceMetadata?: Record<string, string>;
}

/**
 * Create a header chunk (first chunk of a file)
 */
export function createHeaderChunk(
  documentRef: string,
  metadata: FileMetadata
): StreamingChunk {
  // Create FileStorageReference for S3
  const storageRef = create(FileStorageReferenceSchema, {
    driveName: 's3-bucket', // Will be updated by repo-service
    objectKey: documentRef,
  });

  // Create Blob for header
  const blob = create(BlobSchema, {
    blobId: documentRef,
    driveId: 's3-drive',
    content: {
      case: 'storageRef',
      value: storageRef,
    },
    mimeType: metadata.mimeType,
    filename: metadata.filename,
    sizeBytes: metadata.sizeBytes,
    checksum: '', // Will be set in footer with actual SHA256
    checksumType: ChecksumType.SHA256,
    metadata: {
      path: metadata.path,
      ...metadata.sourceMetadata,
    },
  });

  return create(StreamingChunkSchema, {
    documentRef,
    chunkNumber: 0,
    isLast: false,
    chunkType: {
      case: 'header',
      value: blob,
    },
  }) as StreamingChunk;
}

/**
 * Create a data chunk (middle chunks containing file content)
 */
export function createDataChunk(
  documentRef: string,
  chunkNumber: number,
  data: Uint8Array,
  isLast: boolean = false
): StreamingChunk {
  return create(StreamingChunkSchema, {
    documentRef,
    chunkNumber,
    isLast,
    chunkType: {
      case: 'rawData',
      value: data,
    },
  }) as StreamingChunk;
}

/**
 * Create a footer chunk (last chunk with final metadata)
 */
export function createFooterChunk(
  documentRef: string,
  chunkNumber: number,
  finalSize: bigint,
  sha256Checksum: string,
  s3Key?: string,
  s3ETag?: string
): StreamingChunk {
  const metadata = create(BlobMetadataSchema, {
    finalSize,
    checksum: sha256Checksum,
    checksumType: ChecksumType.SHA256,
    s3Key: s3Key || '',
    s3Etag: s3ETag || '',
    completedAt: create(TimestampSchema, {
      seconds: BigInt(Math.floor(Date.now() / 1000)),
      nanos: 0,
    }),
    finalMetadata: {},
  });

  return create(StreamingChunkSchema, {
    documentRef,
    chunkNumber,
    isLast: true,
    chunkType: {
      case: 'footer',
      value: metadata,
    },
  }) as StreamingChunk;
}

/**
 * Streaming hash calculator for computing SHA256 incrementally
 */
export class StreamingHashCalculator {
  private hash = createHash('sha256');
  private bytesProcessed = 0n;
  private cachedDigest: Buffer | null = null;

  /**
   * Update hash with new data chunk
   */
  update(chunk: Uint8Array): void {
    this.hash.update(chunk);
    this.bytesProcessed += BigInt(chunk.length);
  }

  /**
   * Get final digest (cached after first call)
   */
  private getDigest(): Buffer {
    if (!this.cachedDigest) {
      this.cachedDigest = this.hash.digest();
    }
    return this.cachedDigest;
  }

  /**
   * Get final SHA256 hash (base64)
   */
  getHashBase64(): string {
    return this.getDigest().toString('base64');
  }

  /**
   * Get final SHA256 hash (hex)
   */
  getHashHex(): string {
    return this.getDigest().toString('hex');
  }

  /**
   * Get total bytes processed
   */
  getBytesProcessed(): bigint {
    return this.bytesProcessed;
  }
}

/**
 * Helper to create a document reference
 */
export function createDocumentRef(connectorId: string, filePath: string, uniqueSuffix?: string): string {
  const suffix = uniqueSuffix || `${Date.now()}-${Math.random().toString(36).substring(7)}`;
  return `${connectorId}:${filePath}:${suffix}`;
}
