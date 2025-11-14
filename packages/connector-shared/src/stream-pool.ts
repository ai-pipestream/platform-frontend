import { createClient, type Client } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import type { MessageInitShape } from '@bufbuild/protobuf';
import {
  ConnectorIntakeService,
  DocumentIntakeRequestSchema,
  type DocumentIntakeRequest,
  type DocumentIntakeResponse,
} from '@ai-pipestream/grpc-stubs/dist/module/connectors/connector_intake_service_pb';
import chalk from 'chalk';
import { EventEmitter } from 'events';

// Configuration
const CONNECTOR_INTAKE_SERVICE_URL = process.env.CONNECTOR_INTAKE_SERVICE_URL || 'http://localhost:38108';

/**
 * Represents a single active gRPC stream in the pool
 */
class StreamConnection extends EventEmitter {
  public readonly id: number;
  private stream: Promise<DocumentIntakeResponse> | null = null;
  private requestQueue: MessageInitShape<typeof DocumentIntakeRequestSchema>[] = [];
  private isActive = false;
  private isClosed = false;
  private queueWaiters: Array<() => void> = [];
  private pendingResponses = new Map<string, (response: any) => void>(); // documentRef -> resolver

  constructor(
    id: number,
    private client: Client<typeof ConnectorIntakeService>,
    private connectorId: string,
    private apiKey: string,
    private crawlId: string
  ) {
    super();
    this.id = id;
  }

  /**
   * Initialize the stream with SessionStart
   */
  async initialize(): Promise<void> {
    if (this.isActive) {
      throw new Error(`Stream ${this.id} is already active`);
    }

    console.log(chalk.gray(`[Stream ${this.id}] Initializing...`));

    // Create session start request
    const sessionRequest: MessageInitShape<typeof DocumentIntakeRequestSchema> = {
      sessionInfo: {
        value: {
          connectorId: this.connectorId,
          apiKey: this.apiKey,
          crawlId: this.crawlId,
          crawlMetadata: {
            connectorType: 'filesystem',
            connectorVersion: '1.0.0',
            crawlStarted: {
              seconds: BigInt(Math.floor(Date.now() / 1000)),
              nanos: 0,
            },
            sourceSystem: 'local-filesystem',
          },
        },
        case: 'sessionStart' as const,
      },
    };

    // Create async generator that yields from the queue
    const self = this;
    async function* requestGenerator() {
      // First, yield the session start
      yield sessionRequest;

      // Then yield from queue as items are added
      while (!self.isClosed) {
        // Wait for items to be added to queue
        if (self.requestQueue.length === 0) {
          await new Promise<void>(resolve => {
            self.queueWaiters.push(resolve);
          });
        }

        // Yield all items from queue
        while (self.requestQueue.length > 0) {
          const request = self.requestQueue.shift()!;
          console.log(chalk.gray(`[Stream ${self.id}] Yielding request: ${request.sessionInfo?.case ?? 'unknown'}`));
          yield request;
        }
      }
    }

    // Start the stream
    const requestIterable = {
      [Symbol.asyncIterator]: requestGenerator,
    };

    this.stream = this.client.streamDocuments(requestIterable);
    this.isActive = true;

    // Start consuming responses in background
    this.consumeResponses();

    console.log(chalk.green(`[Stream ${this.id}] Initialized and ready`));
  }

  /**
   * Consume the SINGLE response from client-side streaming
   * With client-side streaming, we only get ONE response at the end
   */
  private async consumeResponses(): Promise<void> {
    if (!this.stream) return;

    try {
      // Client-side streaming returns a SINGLE response, not a stream of responses
      // The stream is the REQUEST stream, not the response stream
      const response = await this.stream;

      // Handle the single final response
      if (response.response?.case === 'sessionResponse') {
        if (response.response.value.authenticated) {
          console.log(chalk.green(`[Stream ${this.id}] Authenticated: ${response.response.value.sessionId}`));
          this.emit('authenticated', response.response.value.sessionId);
        } else {
          console.error(chalk.red(`[Stream ${this.id}] Authentication failed: ${response.response.value.message}`));
          this.emit('error', new Error(`Authentication failed: ${response.response.value.message}`));
        }
      } else if (response.response?.case === 'batchResponse') {
        // New batch response for client-side streaming
        const batchResponse = response.response.value;
        console.log(chalk.green(`[Stream ${this.id}] Batch complete: ${batchResponse.message}`));
        console.log(chalk.cyan(`  Total: ${batchResponse.totalDocuments}, Success: ${batchResponse.successful}, Failed: ${batchResponse.failed}`));

        // Resolve all pending responses
        for (const docResponse of batchResponse.results) {
          if (docResponse.sourceId && this.pendingResponses.has(docResponse.sourceId)) {
            const resolver = this.pendingResponses.get(docResponse.sourceId)!;
            this.pendingResponses.delete(docResponse.sourceId);
            resolver(docResponse);
          }
        }

        this.emit('batchComplete', batchResponse);
      } else if (response.response?.case === 'documentResponse') {
        // Fallback for single document response
        const docResponse = response.response.value;
        if (docResponse.sourceId && this.pendingResponses.has(docResponse.sourceId)) {
          const resolver = this.pendingResponses.get(docResponse.sourceId)!;
          this.pendingResponses.delete(docResponse.sourceId);
          resolver(docResponse);
        }
        this.emit('documentResponse', docResponse);
      }
    } catch (error: any) {
      console.error(chalk.red(`[Stream ${this.id}] Stream error: ${error.message}`));
      this.emit('error', error);
    } finally {
      this.isActive = false;
      this.isClosed = true;
      this.emit('closed');
    }
  }

  /**
   * Queue a document request to be sent on this stream
   * Only waits for response if waitForResponse is true (for footer chunks)
   */
  queueRequest(request: MessageInitShape<typeof DocumentIntakeRequestSchema>, waitForResponse: boolean = false, documentRef?: string): Promise<{ success: boolean; documentId?: string; error?: string }> {
    if (this.isClosed) {
      return Promise.resolve({ success: false, error: 'Stream is closed' });
    }

    console.log(chalk.gray(`[Stream ${this.id}] Queueing request: ${request.sessionInfo?.case ?? 'unknown'}`));

    // Add to queue
    this.requestQueue.push(request);

    // Wake up any waiting generators
    const waiters = this.queueWaiters.splice(0);
    waiters.forEach(resolve => resolve());

    // Only wait for response if explicitly requested (e.g., footer chunk)
    if (waitForResponse && documentRef) {
      return new Promise((resolve) => {
        // Register the resolver for this documentRef
        this.pendingResponses.set(documentRef, (docResponse: any) => {
          if (docResponse.success) {
            resolve({ success: true, documentId: docResponse.documentId });
          } else {
            resolve({ success: false, error: docResponse.errorMessage });
          }
        });

        // Add timeout to prevent hanging forever
        setTimeout(() => {
          if (this.pendingResponses.has(documentRef)) {
            this.pendingResponses.delete(documentRef);
            resolve({ success: false, error: 'Response timeout' });
          }
        }, 30000); // 30 second timeout
      });
    } else {
      // Fire and forget for data chunks
      return Promise.resolve({ success: true });
    }
  }

  /**
   * Close the stream gracefully
   */
  async close(): Promise<void> {
    if (this.isClosed) return;

    console.log(chalk.gray(`[Stream ${this.id}] Closing...`));
    this.isClosed = true;

    // Wait a bit for pending requests to flush
    await new Promise(resolve => setTimeout(resolve, 100));

    this.isActive = false;
    this.emit('closed');
    console.log(chalk.gray(`[Stream ${this.id}] Closed`));
  }

  /**
   * Check if stream is ready to accept requests
   */
  isReady(): boolean {
    return this.isActive && !this.isClosed;
  }
}

/**
 * Pool of gRPC streams for parallel document uploads
 */
export class StreamPool {
  private streams: StreamConnection[] = [];
  private client: Client<typeof ConnectorIntakeService>;
  private currentStreamIndex = 0;

  constructor(
    private connectorId: string,
    private apiKey: string,
    private crawlId: string,
    private poolSize: number = 1
  ) {
    // Create gRPC transport
    const intakeTransport = createGrpcTransport({
      baseUrl: CONNECTOR_INTAKE_SERVICE_URL,
      idleConnectionTimeoutMs: 1000 * 60 * 10, // 10 minutes for long-lived streams
    });

    // Create service client
    this.client = createClient(ConnectorIntakeService, intakeTransport);

    console.log(chalk.cyan(`Creating stream pool with ${poolSize} stream(s)`));
  }

  /**
   * Initialize all streams in the pool
   */
  async initialize(): Promise<void> {
    console.log(chalk.cyan(`Initializing ${this.poolSize} stream(s)...`));

    // Create and initialize all streams
    const initPromises = [];
    for (let i = 0; i < this.poolSize; i++) {
      const stream = new StreamConnection(i, this.client, this.connectorId, this.apiKey, this.crawlId);
      this.streams.push(stream);
      initPromises.push(stream.initialize());
    }

    // Wait for all streams to authenticate
    await Promise.all(initPromises);

    console.log(chalk.green(`✓ Stream pool ready with ${this.poolSize} stream(s)`));
  }

  /**
   * Get the next available stream (round-robin)
   */
  private getNextStream(): StreamConnection {
    // Round-robin selection
    const stream = this.streams[this.currentStreamIndex];
    this.currentStreamIndex = (this.currentStreamIndex + 1) % this.streams.length;

    if (!stream.isReady()) {
      // If stream is not ready, try to find another one
      for (const s of this.streams) {
        if (s.isReady()) {
          return s;
        }
      }
      throw new Error('No ready streams available');
    }

    return stream;
  }

  /**
   * Queue a document request on the next available stream
   * Set waitForResponse=true for footer chunks to get the final documentId
   */
  async queueDocument(request: MessageInitShape<typeof DocumentIntakeRequestSchema>, waitForResponse: boolean = false, documentRef?: string): Promise<{ success: boolean; documentId?: string; error?: string }> {
    const stream = this.getNextStream();
    return stream.queueRequest(request, waitForResponse, documentRef);
  }

  /**
   * Close all streams in the pool
   */
  async closeAll(): Promise<void> {
    console.log(chalk.cyan('Closing stream pool...'));
    await Promise.all(this.streams.map(s => s.close()));
    console.log(chalk.green('✓ Stream pool closed'));
  }

  /**
   * Get pool statistics
   */
  getStats(): { total: number; active: number; closed: number } {
    return {
      total: this.streams.length,
      active: this.streams.filter(s => s.isReady()).length,
      closed: this.streams.filter(s => !s.isReady()).length,
    };
  }
}
