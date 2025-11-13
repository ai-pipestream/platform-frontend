/**
 * Document Streamer V2 - Uses StreamPool and header/footer protocol
 *
 * Protocol for ALL files (small and large):
 *   1. Header chunk: Blob with metadata
 *   2. Data chunks: Raw file content
 *   3. Footer chunk: BlobMetadata with actual SHA256, size, S3 ETag
 */

import { create } from '@bufbuild/protobuf';
import { TimestampSchema } from '@bufbuild/protobuf/wkt';
import { DocumentIntakeRequestSchema, DocumentDataSchema, type DocumentIntakeRequest } from '@ai-pipestream/grpc-stubs/dist/module/connectors/connector_intake_service_pb';
import { ChecksumType } from '@ai-pipestream/grpc-stubs/dist/core/pipeline_core_types_pb';
import { createReadStream, ReadStream } from 'fs';
import { stat } from 'fs/promises';
import { basename, relative } from 'path';
import mime from 'mime-types';
import chalk from 'chalk';
import { StreamPool } from './stream-pool.js';
import {
  createHeaderChunk,
  createDataChunk,
  createFooterChunk,
  createDocumentRef,
  StreamingHashCalculator,
  DEFAULT_CHUNK_SIZE,
  type FileMetadata,
} from './streaming-protocol.js';

/**
 * Document streamer that uses StreamPool for multiplexed uploads
 */
export class DocumentStreamer {
  private streamPool: StreamPool;
  private connectorId: string;
  private crawlId: string;

  constructor(streamPool: StreamPool, connectorId: string, crawlId: string) {
    this.streamPool = streamPool;
    this.connectorId = connectorId;
    this.crawlId = crawlId;
  }

  /**
   * Stream a file from filesystem
   */
  async streamFile(
    filePath: string,
    basePath: string = ''
  ): Promise<{ success: boolean; documentId?: string; error?: string; sha256?: string }> {
    try {
      // Get file stats
      const stats = await stat(filePath);
      const fileName = basename(filePath);
      const relativePath = basePath ? relative(basePath, filePath) : fileName;
      const mimeType = mime.lookup(filePath) || 'application/octet-stream';

      // Create metadata
      const metadata: FileMetadata = {
        filename: fileName,
        path: relativePath,
        mimeType,
        sizeBytes: BigInt(stats.size),
        sourceCreated: stats.birthtime,
        sourceModified: stats.mtime,
        sourceMetadata: {
          'original-path': filePath,
          'file-size': stats.size.toString(),
        },
      };

      // Stream the file using the new protocol
      return await this.streamFileWithProtocol(filePath, relativePath, metadata);
    } catch (error: any) {
      console.error(chalk.red(`Error streaming file ${filePath}: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * Stream a file buffer from memory (for web uploads)
   */
  async streamFileBuffer(
    buffer: Buffer,
    fileName: string
  ): Promise<{ success: boolean; documentId?: string; error?: string; sha256?: string }> {
    try {
      const mimeType = mime.lookup(fileName) || 'application/octet-stream';

      // Create metadata
      const metadata: FileMetadata = {
        filename: fileName,
        path: fileName,
        mimeType,
        sizeBytes: BigInt(buffer.length),
        sourceCreated: new Date(),
        sourceModified: new Date(),
        sourceMetadata: {
          'file-size': buffer.length.toString(),
          'source': 'web-upload',
        },
      };

      // Stream the buffer using the new protocol
      return await this.streamBufferWithProtocol(buffer, fileName, metadata);
    } catch (error: any) {
      console.error(chalk.red(`Error streaming buffer ${fileName}: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * Stream a ReadStream from HTTP request (for web uploads with no buffering)
   */
  async streamFromReadStream(
    readStream: ReadStream | NodeJS.ReadableStream,
    fileName: string,
    fileSizeHint?: number
  ): Promise<{ success: boolean; documentId?: string; error?: string; sha256?: string }> {
    try {
      const mimeType = mime.lookup(fileName) || 'application/octet-stream';

      // Create metadata (size will be updated in footer)
      const metadata: FileMetadata = {
        filename: fileName,
        path: fileName,
        mimeType,
        sizeBytes: fileSizeHint ? BigInt(fileSizeHint) : 0n,
        sourceCreated: new Date(),
        sourceModified: new Date(),
        sourceMetadata: {
          'source': 'web-upload-stream',
        },
      };

      // Stream from ReadStream using the new protocol
      return await this.streamReadStreamWithProtocol(readStream, fileName, metadata);
    } catch (error: any) {
      console.error(chalk.red(`Error streaming ReadStream ${fileName}: ${error.message}`));
      return { success: false, error: error.message };
    }
  }

  /**
   * Stream a file using header/data/footer protocol
   */
  private async streamFileWithProtocol(
    filePath: string,
    relativePath: string,
    metadata: FileMetadata
  ): Promise<{ success: boolean; documentId?: string; error?: string; sha256?: string }> {
    const documentRef = createDocumentRef(this.connectorId, relativePath);
    const hashCalculator = new StreamingHashCalculator();

    // Create header chunk
    const headerChunk = createHeaderChunk(documentRef, metadata);

    // Create DocumentData with header
    const headerDocumentData = create(DocumentDataSchema, {
      sourceId: relativePath,
      filename: metadata.filename,
      path: metadata.path,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      sourceCreated: metadata.sourceCreated ? create(TimestampSchema, {
        seconds: BigInt(Math.floor(metadata.sourceCreated.getTime() / 1000)),
        nanos: 0,
      }) : undefined,
      sourceModified: metadata.sourceModified ? create(TimestampSchema, {
        seconds: BigInt(Math.floor(metadata.sourceModified.getTime() / 1000)),
        nanos: 0,
      }) : undefined,
      sourceMetadata: metadata.sourceMetadata,
      content: {
        case: 'chunk',
        value: headerChunk,
      },
    });

    // Queue header
    const headerRequest = create(DocumentIntakeRequestSchema, {
      sessionInfo: {
        case: 'document',
        value: headerDocumentData,
      },
    }) as DocumentIntakeRequest;

    // Fire and forget header (don't wait for response)
    this.streamPool.queueDocument(headerRequest, false);

    // Stream file data in chunks
    let chunkNumber = 1;
    const fileStream = createReadStream(filePath, { highWaterMark: DEFAULT_CHUNK_SIZE });

    for await (const chunk of fileStream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      hashCalculator.update(buffer);

      const dataChunk = createDataChunk(documentRef, chunkNumber++, buffer, false);

      const dataDocumentData = create(DocumentDataSchema, {
        sourceId: relativePath,
        filename: metadata.filename,
        path: metadata.path,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        content: {
          case: 'chunk',
          value: dataChunk,
        },
      });

      const dataRequest = create(DocumentIntakeRequestSchema, {
        sessionInfo: {
          case: 'document',
          value: dataDocumentData,
        },
      }) as DocumentIntakeRequest;

      // Fire and forget data chunks (don't wait for response)
      this.streamPool.queueDocument(dataRequest, false);
    }

    // Create and queue footer chunk
    const sha256 = hashCalculator.getHashHex();
    const finalSize = hashCalculator.getBytesProcessed();
    const footerChunk = createFooterChunk(documentRef, chunkNumber, finalSize, sha256);

    const footerDocumentData = create(DocumentDataSchema, {
      sourceId: relativePath,
      filename: metadata.filename,
      path: metadata.path,
      mimeType: metadata.mimeType,
      sizeBytes: finalSize,
      checksum: hashCalculator.getHashBase64(),
      checksumType: 'SHA256',
      content: {
        case: 'chunk',
        value: footerChunk,
      },
    });

    const footerRequest = create(DocumentIntakeRequestSchema, {
      sessionInfo: {
        case: 'document',
        value: footerDocumentData,
      },
    }) as DocumentIntakeRequest;

    // Wait for response on footer to get final documentId (use relativePath as correlation key since that's the sourceId)
    const result = await this.streamPool.queueDocument(footerRequest, true, relativePath);

    if (result.success) {
      console.log(chalk.green(`✓ Uploaded: ${relativePath} (SHA256: ${sha256.substring(0, 16)}...)`));
      return { success: true, documentId: result.documentId, sha256 };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Stream a buffer using header/data/footer protocol
   */
  private async streamBufferWithProtocol(
    buffer: Buffer,
    fileName: string,
    metadata: FileMetadata
  ): Promise<{ success: boolean; documentId?: string; error?: string; sha256?: string }> {
    const documentRef = createDocumentRef(this.connectorId, fileName);
    const hashCalculator = new StreamingHashCalculator();

    // Create header chunk
    const headerChunk = createHeaderChunk(documentRef, metadata);

    const headerDocumentData = create(DocumentDataSchema, {
      sourceId: fileName,
      filename: metadata.filename,
      path: metadata.path,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      sourceCreated: metadata.sourceCreated ? create(TimestampSchema, {
        seconds: BigInt(Math.floor(metadata.sourceCreated.getTime() / 1000)),
        nanos: 0,
      }) : undefined,
      sourceModified: metadata.sourceModified ? create(TimestampSchema, {
        seconds: BigInt(Math.floor(metadata.sourceModified.getTime() / 1000)),
        nanos: 0,
      }) : undefined,
      sourceMetadata: metadata.sourceMetadata,
      content: {
        case: 'chunk',
        value: headerChunk,
      },
    });

    const headerRequest = create(DocumentIntakeRequestSchema, {
      sessionInfo: {
        case: 'document',
        value: headerDocumentData,
      },
    }) as DocumentIntakeRequest;

    await this.streamPool.queueDocument(headerRequest);

    // Stream buffer in chunks
    let chunkNumber = 1;
    let offset = 0;

    while (offset < buffer.length) {
      const chunkSize = Math.min(DEFAULT_CHUNK_SIZE, buffer.length - offset);
      const chunkData = buffer.subarray(offset, offset + chunkSize);
      hashCalculator.update(chunkData);

      const dataChunk = createDataChunk(documentRef, chunkNumber++, chunkData, false);

      const dataDocumentData = create(DocumentDataSchema, {
        sourceId: fileName,
        filename: metadata.filename,
        path: metadata.path,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        content: {
          case: 'chunk',
          value: dataChunk,
        },
      });

      const dataRequest = create(DocumentIntakeRequestSchema, {
        sessionInfo: {
          case: 'document',
          value: dataDocumentData,
        },
      }) as DocumentIntakeRequest;

      await this.streamPool.queueDocument(dataRequest);
      offset += chunkSize;
    }

    // Create and queue footer chunk
    const sha256 = hashCalculator.getHashHex();
    const finalSize = hashCalculator.getBytesProcessed();
    const footerChunk = createFooterChunk(documentRef, chunkNumber, finalSize, sha256);

    const footerDocumentData = create(DocumentDataSchema, {
      sourceId: fileName,
      filename: metadata.filename,
      path: metadata.path,
      mimeType: metadata.mimeType,
      sizeBytes: finalSize,
      checksum: hashCalculator.getHashBase64(),
      checksumType: 'SHA256',
      content: {
        case: 'chunk',
        value: footerChunk,
        },
    });

    const footerRequest = create(DocumentIntakeRequestSchema, {
      sessionInfo: {
        case: 'document',
        value: footerDocumentData,
      },
    }) as DocumentIntakeRequest;

    const result = await this.streamPool.queueDocument(footerRequest);

    if (result.success) {
      console.log(chalk.green(`✓ Uploaded: ${fileName} (SHA256: ${sha256.substring(0, 16)}...)`));
      return { success: true, documentId: result.documentId, sha256 };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Stream from a ReadStream using header/data/footer protocol (NO BUFFERING!)
   */
  private async streamReadStreamWithProtocol(
    readStream: ReadStream | NodeJS.ReadableStream,
    fileName: string,
    metadata: FileMetadata
  ): Promise<{ success: boolean; documentId?: string; error?: string; sha256?: string }> {
    const documentRef = createDocumentRef(this.connectorId, fileName);
    const hashCalculator = new StreamingHashCalculator();

    // Create header chunk
    const headerChunk = createHeaderChunk(documentRef, metadata);

    const headerDocumentData = create(DocumentDataSchema, {
      sourceId: fileName,
      filename: metadata.filename,
      path: metadata.path,
      mimeType: metadata.mimeType,
      sizeBytes: metadata.sizeBytes,
      sourceCreated: metadata.sourceCreated ? create(TimestampSchema, {
        seconds: BigInt(Math.floor(metadata.sourceCreated.getTime() / 1000)),
        nanos: 0,
      }) : undefined,
      sourceModified: metadata.sourceModified ? create(TimestampSchema, {
        seconds: BigInt(Math.floor(metadata.sourceModified.getTime() / 1000)),
        nanos: 0,
      }) : undefined,
      sourceMetadata: metadata.sourceMetadata,
      content: {
        case: 'chunk',
        value: headerChunk,
      },
    });

    const headerRequest = create(DocumentIntakeRequestSchema, {
      sessionInfo: {
        case: 'document',
        value: headerDocumentData,
      },
    }) as DocumentIntakeRequest;

    await this.streamPool.queueDocument(headerRequest);

    // Stream data chunks from ReadStream (NO BUFFERING!)
    let chunkNumber = 1;
    let buffer = Buffer.alloc(0);

    for await (const chunk of readStream) {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, bufferChunk]);

      // Process complete chunks
      while (buffer.length >= DEFAULT_CHUNK_SIZE) {
        const chunkData = buffer.subarray(0, DEFAULT_CHUNK_SIZE);
        buffer = buffer.subarray(DEFAULT_CHUNK_SIZE);
        hashCalculator.update(chunkData);

        const dataChunk = createDataChunk(documentRef, chunkNumber++, chunkData, false);

        const dataDocumentData = create(DocumentDataSchema, {
          sourceId: fileName,
          filename: metadata.filename,
          path: metadata.path,
          mimeType: metadata.mimeType,
          sizeBytes: metadata.sizeBytes,
          content: {
            case: 'chunk',
            value: dataChunk,
          },
        });

        const dataRequest = create(DocumentIntakeRequestSchema, {
          sessionInfo: {
            case: 'document',
            value: dataDocumentData,
          },
        }) as DocumentIntakeRequest;

        await this.streamPool.queueDocument(dataRequest);
      }
    }

    // Send remaining buffer as final data chunk
    if (buffer.length > 0) {
      hashCalculator.update(buffer);

      const dataChunk = createDataChunk(documentRef, chunkNumber++, buffer, false);

      const dataDocumentData = create(DocumentDataSchema, {
        sourceId: fileName,
        filename: metadata.filename,
        path: metadata.path,
        mimeType: metadata.mimeType,
        sizeBytes: metadata.sizeBytes,
        content: {
          case: 'chunk',
          value: dataChunk,
        },
      });

      const dataRequest = create(DocumentIntakeRequestSchema, {
        sessionInfo: {
          case: 'document',
          value: dataDocumentData,
        },
      }) as DocumentIntakeRequest;

      await this.streamPool.queueDocument(dataRequest);
    }

    // Create and queue footer chunk with ACTUAL size and SHA256
    const sha256 = hashCalculator.getHashHex();
    const finalSize = hashCalculator.getBytesProcessed();
    const footerChunk = createFooterChunk(documentRef, chunkNumber, finalSize, sha256);

    const footerDocumentData = create(DocumentDataSchema, {
      sourceId: fileName,
      filename: metadata.filename,
      path: metadata.path,
      mimeType: metadata.mimeType,
      sizeBytes: finalSize,
      checksum: hashCalculator.getHashBase64(),
      checksumType: 'SHA256',
      content: {
        case: 'chunk',
        value: footerChunk,
      },
    });

    const footerRequest = create(DocumentIntakeRequestSchema, {
      sessionInfo: {
        case: 'document',
        value: footerDocumentData,
      },
    }) as DocumentIntakeRequest;

    const result = await this.streamPool.queueDocument(footerRequest);

    if (result.success) {
      console.log(chalk.green(`✓ Uploaded (streamed): ${fileName} (SHA256: ${sha256.substring(0, 16)}...)`));
      return { success: true, documentId: result.documentId, sha256 };
    } else {
      return { success: false, error: result.error };
    }
  }
}
