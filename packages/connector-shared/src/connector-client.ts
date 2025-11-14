import { createClient } from '@connectrpc/connect';
import { createGrpcTransport } from '@connectrpc/connect-node';
import {
  ConnectorIntakeService,
  ConnectorAdminService,
  type ConnectorConfig,
} from '@ai-pipestream/grpc-stubs/dist/module/connectors/connector_intake_service_pb';
import chalk from 'chalk';

// Configuration
const CONNECTOR_INTAKE_SERVICE_URL = process.env.CONNECTOR_INTAKE_SERVICE_URL || 'http://localhost:38108';
const CONNECTOR_SERVICE_URL = process.env.CONNECTOR_SERVICE_URL || 'http://localhost:38107';

// Create gRPC transports
const intakeTransport = createGrpcTransport({
  baseUrl: CONNECTOR_INTAKE_SERVICE_URL,
  idleConnectionTimeoutMs: 1000 * 60 * 5, // 5 minutes
});

const connectorTransport = createGrpcTransport({
  baseUrl: CONNECTOR_SERVICE_URL,
  idleConnectionTimeoutMs: 1000 * 60 * 5, // 5 minutes
});

// Create service clients
const intakeClient = createClient(ConnectorIntakeService, intakeTransport);
const connectorAdminClient = createClient(ConnectorAdminService, connectorTransport);

/**
 * Connector client for managing filesystem connector operations
 */
export class ConnectorClient {
  private connectorId: string | null = null;
  private apiKey: string | null = null;
  private connectorConfig: ConnectorConfig | null = null;

  /**
   * Register or get existing connector
   */
  async registerConnector(
    connectorName: string,
    accountId: string,
    s3Bucket: string,
    s3BasePath: string
  ): Promise<{ connectorId: string; apiKey: string }> {
    try {
      // Try to get existing connector
      // Add timeout to prevent hanging
      const connector = await Promise.race([
        connectorAdminClient.getConnector({ connectorId: connectorName }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
      ]);

      console.log(chalk.green(`✓ Using existing connector: ${connector.connectorId}`));
      this.connectorId = connector.connectorId;
      this.apiKey = connector.apiKey;
      return { connectorId: connector.connectorId, apiKey: connector.apiKey };
    } catch (error: any) {
      // Connector doesn't exist, register it
      if (error.code === 'NOT_FOUND' || error.message?.includes('not found') || error.message === 'Timeout') {
        console.log(chalk.yellow(`Registering new connector: ${connectorName}`));
        
        const response = await connectorAdminClient.registerConnector({
          connectorName: connectorName,
          connectorType: 'filesystem',
          accountId: accountId,
          s3Bucket: s3Bucket,
          s3BasePath: s3BasePath,
          defaultMetadata: {
            'source': 'filesystem-connector',
            'connector-type': 'filesystem',
          },
          maxFileSize: BigInt(104857600), // 100MB
          rateLimitPerMinute: BigInt(1000),
        });

        console.log(chalk.green(`✓ Registered connector: ${response.connectorId}`));
        this.connectorId = response.connectorId;
        this.apiKey = response.apiKey;
        return { connectorId: response.connectorId, apiKey: response.apiKey };
      }
      throw error;
    }
  }

  /**
   * Set credentials for an existing connector (skip registration)
   */
  setCredentials(connectorId: string, apiKey: string): void {
    this.connectorId = connectorId;
    this.apiKey = apiKey;
  }

  /**
   * Start a crawl session
   */
  async startCrawlSession(crawlId: string): Promise<string> {
    if (!this.connectorId || !this.apiKey) {
      throw new Error('Connector not registered. Call registerConnector() first.');
    }

    const response = await intakeClient.startCrawlSession({
      connectorId: this.connectorId,
      apiKey: this.apiKey,
      crawlId: crawlId,
      metadata: {
        connectorType: 'filesystem',
        connectorVersion: '1.0.0',
        crawlStarted: {
          seconds: BigInt(Math.floor(Date.now() / 1000)),
          nanos: 0,
        },
        sourceSystem: 'local-filesystem',
      },
      trackDocuments: true,
      deleteOrphans: false,
    });

    if (response.success) {
      console.log(chalk.green(`✓ Started crawl session: ${response.sessionId}`));
      return response.sessionId;
    } else {
      throw new Error(`Failed to start crawl session: ${response.message}`);
    }
  }

  /**
   * End a crawl session
   */
  async endCrawlSession(
    sessionId: string,
    crawlId: string,
    summary: {
      documentsFound: number;
      documentsProcessed: number;
      documentsFailed: number;
      bytesProcessed: number;
    }
  ): Promise<void> {
    const response = await intakeClient.endCrawlSession({
      sessionId: sessionId,
      crawlId: crawlId,
      summary: {
        documentsFound: summary.documentsFound,
        documentsProcessed: summary.documentsProcessed,
        documentsFailed: summary.documentsFailed,
        documentsSkipped: 0,
        bytesProcessed: BigInt(summary.bytesProcessed),
        started: {
          seconds: BigInt(Math.floor(Date.now() / 1000)),
          nanos: 0,
        },
        completed: {
          seconds: BigInt(Math.floor(Date.now() / 1000)),
          nanos: 0,
        },
      },
    });

    if (response.success) {
      console.log(chalk.green(`✓ Ended crawl session: ${sessionId}`));
      if (response.orphansFound > 0) {
        console.log(chalk.yellow(`  Found ${response.orphansFound} orphaned documents`));
      }
    } else {
      throw new Error(`Failed to end crawl session: ${response.message}`);
    }
  }

  /**
   * Send heartbeat
   */
  async sendHeartbeat(
    sessionId: string,
    crawlId: string,
    documentsQueued: number,
    documentsProcessing: number
  ): Promise<void> {
    await intakeClient.heartbeat({
      sessionId: sessionId,
      crawlId: crawlId,
      documentsQueued: documentsQueued,
      documentsProcessing: documentsProcessing,
      metrics: {
        'memory_used_mb': String(process.memoryUsage().heapUsed / 1024 / 1024),
        'cpu_percent': '0', // TODO: Add actual CPU monitoring
      },
    });
  }

  /**
   * Get connector ID
   */
  getConnectorId(): string {
    if (!this.connectorId) {
      throw new Error('Connector not registered');
    }
    return this.connectorId;
  }

  /**
   * Get API key
   */
  getApiKey(): string {
    if (!this.apiKey) {
      throw new Error('Connector not registered');
    }
    return this.apiKey;
  }
}
