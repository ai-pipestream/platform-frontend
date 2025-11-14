import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { PlatformRegistration, ServiceDetails } from "@ai-pipestream/grpc-stubs/dist/registration/platform_registration_pb";

// This map holds the live state of all healthy, registered services.
// It is populated by the WatchServices stream.
const serviceRegistry = new Map<string, ServiceDetails>();

// Get platform-registration-service URL from environment or use default
const REGISTRATION_HOST = process.env.PLATFORM_REGISTRATION_HOST || 'localhost';
const REGISTRATION_PORT = process.env.PLATFORM_REGISTRATION_PORT || '38101';
const REGISTRATION_URL = `http://${REGISTRATION_HOST}:${REGISTRATION_PORT}`;

console.log(`[ServiceResolver] Using platform-registration-service at ${REGISTRATION_URL}`);

// Create a persistent transport to platform-registration-service
const registrationTransport = createGrpcTransport({
  baseUrl: REGISTRATION_URL,
  idleConnectionTimeoutMs: 1000 * 60 * 60, // 1 hour for idle connections
});

const registrationClient = createClient(PlatformRegistration, registrationTransport);

/**
 * Watches the platform-registration-service for real-time updates of all
 * healthy services. This function runs continuously in the background.
 */
async function watchAndCacheServices() {
  console.log("[ServiceResolver] Starting to watch for service updates...");
  try {
    const stream = registrationClient.watchServices({});
    for await (const response of stream) {
      const newRegistry = new Map<string, ServiceDetails>();
      for (const service of response.services) {
        newRegistry.set(service.serviceName, service);
      }
      // Atomically update the registry
      serviceRegistry.clear();
      for (const [key, value] of newRegistry.entries()) {
        serviceRegistry.set(key, value);
      }
    }
  } catch (error) {
    console.error("[ServiceResolver] Watch stream failed:", error);
    console.log("[ServiceResolver] Retrying watch in 5 seconds...");
    setTimeout(watchAndCacheServices, 5000); // Retry after 5 seconds
  }
}

/**
 * Resolves a service name to its actual host:port from the live registry.
 * This is a synchronous lookup against the in-memory cache.
 */
export function resolveService(serviceName: string): { host: string; port: number } {
  const serviceDetails = serviceRegistry.get(serviceName);

  if (!serviceDetails) {
    console.log(`[ServiceResolver] Service "${serviceName}" not found in live registry. Available services:`, Array.from(serviceRegistry.keys()));
    
    // Fallback: Try to resolve common module services directly
    const fallbackPorts: Record<string, number> = {
      'echo': 39000,
      'parser': 39001,
      'chunker': 39002,
      'embedder': 39003,
      'opensearch-sink': 39004
    };
    
    if (fallbackPorts[serviceName]) {
      console.log(`[ServiceResolver] Using fallback for "${serviceName}" -> localhost:${fallbackPorts[serviceName]}`);
      return { host: '127.0.0.1', port: fallbackPorts[serviceName] };
    }
    
    throw new Error(`[ServiceResolver] Service "${serviceName}" not found in live registry. It may be unhealthy or not registered.`);
  }

  // Normalize localhost variants to IPv4 loopback to avoid IPv6 (::1) dial issues
  const normalizedHost = (() => {
    const h = (serviceDetails.host || "").toLowerCase();
    if (h === "localhost" || h === "::1" || h === "0.0.0.0") return "127.0.0.1";
    return serviceDetails.host;
  })();

  const result = {
    host: normalizedHost,
    port: serviceDetails.port,
  };

  // console.log(`[ServiceResolver] Resolved ${serviceName} to ${result.host}:${result.port} from live registry.`);
  return result;
}

/**
 * Create a dynamic transport for a service by name.
 */
export function createDynamicTransport(serviceName:string) {
    const { host, port } = resolveService(serviceName);
    return createGrpcTransport({
        baseUrl: `http://${host}:${port}`,
        // Disable timeouts for streaming connections
        idleConnectionTimeoutMs: 1000 * 60 * 60 // 1 hour for idle connections
    });
}

/**
 * Clears the service registry. Useful for testing.
 */
export function clearServiceRegistry() {
  serviceRegistry.clear();
  console.log("[ServiceResolver] Service registry cleared.");
}

// Start watching for service updates in the background.
watchAndCacheServices();
