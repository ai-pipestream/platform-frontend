import { ConnectRouter, Code, ConnectError } from "@connectrpc/connect";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { PipeStepProcessor } from "@ai-pipestream/grpc-stubs/dist/module/module_service_pb";
import { MappingService } from "@ai-pipestream/grpc-stubs/dist/mapping-service/mapping_service_pb";
import { PlatformRegistration } from "@ai-pipestream/grpc-stubs/dist/registration/platform_registration_pb";
import { Health } from "@ai-pipestream/grpc-stubs/dist/grpc/health/v1/health_pb";
import { ShellService } from "@ai-pipestream/grpc-stubs/dist/frontend/shell_service_pb";
import { NodeUploadService } from "@ai-pipestream/grpc-stubs/dist/repository/filesystem/upload/upload_service_pb";
import { PipeDocService } from "@ai-pipestream/grpc-stubs/dist/repository/pipedoc/pipedoc_service_pb";
import { AccountService } from "@ai-pipestream/grpc-stubs/dist/repository/account/account_service_pb";
import { ConnectorAdminService } from "@ai-pipestream/grpc-stubs/dist/module/connectors/connector_intake_service_pb";
import { createDynamicTransport, resolveService } from "../lib/serviceResolver.js";

// Get platform-registration-service URL from environment or use default
const REGISTRATION_HOST = process.env.PLATFORM_REGISTRATION_HOST || 'localhost';
const REGISTRATION_PORT = process.env.PLATFORM_REGISTRATION_PORT || '38101';
const REGISTRATION_URL = `http://${REGISTRATION_HOST}:${REGISTRATION_PORT}`;

// Create static transport to platform-registration-service (always needs to be available)
const registrationTransport = createGrpcTransport({
  baseUrl: REGISTRATION_URL,
  // Disable timeouts for streaming connections
  idleConnectionTimeoutMs: 1000 * 60 * 60 // 1 hour for idle connections
});

// Dynamic transport resolution based on service name
function selectTransportFromHeader(headerValue: string | null | undefined) {
  if (!headerValue) {
    return registrationTransport; // default target
  }
  
  const serviceName = headerValue.trim().toLowerCase();
  
  // Platform registration service is always at a known location
  if (serviceName === "platform-registration-service") {
    return registrationTransport;
  }

  try {
    // Dynamically resolve other services
    return createDynamicTransport(serviceName);
  } catch (error) {
    console.error(`[Connect] Failed to resolve service ${serviceName}, using default`, error);
    return registrationTransport;
  }
}

export default (router: ConnectRouter) => {
  // Shell Service: aggregated health stream for base services
  router.service(ShellService, {
    async *watchHealth(_req: any, context: any) {
      // Helper: ISO timestamp
      const nowIso = () => new Date().toISOString();

      // Fetch services from platform-registration as source of truth
      const prClient = createClient(PlatformRegistration, registrationTransport);
      let services: Array<{ serviceName: string; tags: string[] }>; 
      try {
        const list = await prClient.listServices({});
        services = (list.services ?? []).map(s => ({
          serviceName: (s as any).serviceName ?? "",
          tags: ((s as any).tags ?? []) as string[],
        }));
      } catch (err) {
        console.error("[Shell] Failed to list services:", err);
        services = [];
      }

      // Base set: include all unique, resolvable gRPC services (skip externals like consul)
      const seen = new Set<string>();
      const candidates = services.filter(s => {
        if (!s.serviceName) return false;
        if (seen.has(s.serviceName)) return false;
        seen.add(s.serviceName);
        return true;
      });

      const baseServices: Array<{ serviceName: string }> = [];
      for (const s of candidates) {
        const name = s.serviceName;
        if (name === 'consul') {
          continue; // not a gRPC health target
        }
        if (name === 'platform-registration-service') {
          baseServices.push({ serviceName: name });
          continue;
        }
        try {
          const { host, port } = resolveService(name);
          if (host && port) {
            baseServices.push({ serviceName: name });
          }
        } catch {
          // skip unresolvable entries
        }
      }

      // Abort propagation
      const controller = new AbortController();
      const abort = () => controller.abort();
      try {
        // @ts-ignore - context.signal exists in Connect runtime
        context?.signal?.addEventListener?.("abort", abort);
      } catch {}

      // Simple async queue to multiplex updates from many streams
      type Update = {
        serviceName: string;
        displayName: string;
        target: string;
        status: number;
        observedAt: string;
      };
      const queue: Update[] = [];
      let resolveNext: (() => void) | null = null;
      const nextPromise = () => new Promise<void>(r => (resolveNext = r));
      const emit = (u: Update) => {
        queue.push(u);
        if (resolveNext) {
          resolveNext();
          resolveNext = null;
        }
      };

      // Start a watcher per base service
      const watchers = baseServices.map(async ({ serviceName }) => {
        try {
          let transport;
          let target = "dynamic";
          if (serviceName === "platform-registration-service") {
            transport = registrationTransport;
            target = (REGISTRATION_URL);
          } else {
            transport = createDynamicTransport(serviceName);
          }
          const healthClient = createClient(Health, transport);
          for await (const resp of healthClient.watch({ service: "" }, { signal: controller.signal, timeoutMs: undefined })) {
            emit({
              serviceName,
              displayName: serviceName,
              target,
              status: (resp as any).status ?? 0,
              observedAt: nowIso(),
            });
          }
        } catch (err) {
          // Emit UNKNOWN on errors
          emit({
            serviceName,
            displayName: serviceName,
            target: "dynamic",
            status: 0,
            observedAt: nowIso(),
          });
        }
      });

      // Yield items as they arrive until aborted
      while (!controller.signal.aborted) {
        while (queue.length > 0) {
          yield queue.shift()!;
        }
        await nextPromise();
      }

      // Cleanup
      try { await Promise.allSettled(watchers); } catch {}
    }
  });
  // Mapping Service proxy
  router.service(MappingService, {
    applyMapping(req: any, context: any) {
      console.log("[Connect] Proxying applyMapping to mapping-service");
      
      try {
        const transport = createDynamicTransport("mapping-service");
        const client = createClient(MappingService, transport);
        return client.applyMapping(req);
      } catch (error) {
        console.error("[Connect] Error proxying applyMapping:", error);
        throw error;
      }
    }
  });

  // Node Upload Service proxy
  router.service(NodeUploadService, {
    initiateUpload(req: any, context: any) {
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(NodeUploadService, transport);
      return client.initiateUpload(req);
    },
    async *streamUploadProgress(req: any, context: any) {
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(NodeUploadService, transport);
      for await (const update of client.streamUploadProgress(req)) {
        yield update;
      }
    },
    uploadChunks(reqStream: any, context: any) {
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(NodeUploadService, transport);
      return client.uploadChunks(reqStream);
    },
    getUploadStatus(req: any, context: any) {
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(NodeUploadService, transport);
      return client.getUploadStatus(req);
    },
    cancelUpload(req: any, context: any) {
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(NodeUploadService, transport);
      return client.cancelUpload(req);
    },
  });
  
  // Module processor proxy (dynamic)
  router.service(PipeStepProcessor, {
    getServiceRegistration(req: any, context: any) {
      const targetBackend = context.requestHeader.get("x-target-backend");
      if (!targetBackend) {
        throw new ConnectError("x-target-backend header is required for module requests", Code.InvalidArgument);
      }
      const transport = createDynamicTransport(targetBackend);
      const client = createClient(PipeStepProcessor, transport);
      return client.getServiceRegistration(req);
    },
    processData(req: any, context: any) {
      const targetBackend = context.requestHeader.get("x-target-backend");
      if (!targetBackend) {
        throw new ConnectError("x-target-backend header is required for module requests", Code.InvalidArgument);
      }
      const transport = createDynamicTransport(targetBackend);
      const client = createClient(PipeStepProcessor, transport);
      return client.processData(req);
    },
    testProcessData(req: any, context: any) {
      const targetBackend = context.requestHeader.get("x-target-backend");
      if (!targetBackend) {
        throw new ConnectError("x-target-backend header is required for module requests", Code.InvalidArgument);
      }
      const transport = createDynamicTransport(targetBackend);
      const client = createClient(PipeStepProcessor, transport);
      return client.testProcessData(req);
    }
  });
  
  // Platform Registration Service proxy
  router.service(PlatformRegistration, {
    async *registerService(req: any) {
      console.log("[Connect] Proxying registerService to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      for await (const event of client.registerService(req)) {
        yield event;
      }
    },
    async *registerModule(req: any) {
      console.log("[Connect] Proxying registerModule to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      for await (const event of client.registerModule(req)) {
        yield event;
      }
    },
    unregisterService(req: any) {
      console.log("[Connect] Proxying unregisterService to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      return client.unregisterService(req);
    },
    unregisterModule(req: any) {
      console.log("[Connect] Proxying unregisterModule to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      return client.unregisterModule(req);
    },
    listServices(req: any) {
      // console.log("[Connect] Proxying listServices to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      return client.listServices(req);
    },
    listModules(req: any) {
      // console.log("[Connect] Proxying listModules to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      return client.listModules(req);
    },
    getService(req: any) {
      console.log("[Connect] Proxying getService to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      return client.getService(req);
    },
    getModule(req: any) {
      console.log("[Connect] Proxying getModule to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      return client.getModule(req);
    },
    async *watchServices(req: any) {
      console.log("[Connect] Proxying watchServices to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      for await (const event of client.watchServices(req)) {
        yield event;
      }
    },
    async *watchModules(req: any) {
      console.log("[Connect] Proxying watchModules to platform-registration-service");
      const client = createClient(PlatformRegistration, registrationTransport);
      for await (const event of client.watchModules(req)) {
        yield event;
      }
    }
  });

  // PipeDoc Service proxy
  router.service(PipeDocService, {
    savePipeDoc(req: any, context: any) {
      console.log("[Connect] Proxying savePipeDoc to repository-service");
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(PipeDocService, transport);
      return client.savePipeDoc(req);
    },
    getPipeDoc(req: any, context: any) {
      console.log("[Connect] Proxying getPipeDoc to repository-service");
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(PipeDocService, transport);
      return client.getPipeDoc(req);
    },
    listPipeDocs(req: any, context: any) {
      console.log("[Connect] Proxying listPipeDocs to repository-service");
      const target = context.requestHeader.get("x-target-backend") || "repository-service";
      const transport = createDynamicTransport(target);
      const client = createClient(PipeDocService, transport);
      return client.listPipeDocs(req);
    }
  });

  // Account Service proxy
  router.service(AccountService, {
    createAccount(req: any, context: any) {
      console.log("[Connect] Proxying createAccount to account-manager");
      const transport = createDynamicTransport("account-manager");
      const client = createClient(AccountService, transport);
      return client.createAccount(req);
    },
    updateAccount(req: any, context: any) {
      console.log("[Connect] Proxying updateAccount to account-manager");
      const transport = createDynamicTransport("account-manager");
      const client = createClient(AccountService, transport);
      return client.updateAccount(req);
    },
    getAccount(req: any, context: any) {
      console.log("[Connect] Proxying getAccount to account-manager");
      const transport = createDynamicTransport("account-manager");
      const client = createClient(AccountService, transport);
      return client.getAccount(req);
    },
    inactivateAccount(req: any, context: any) {
      console.log("[Connect] Proxying inactivateAccount to account-manager");
      const transport = createDynamicTransport("account-manager");
      const client = createClient(AccountService, transport);
      return client.inactivateAccount(req);
    },
    listAccounts(req: any, context: any) {
      console.log("[Connect] Proxying listAccounts to account-manager");
      const transport = createDynamicTransport("account-manager");
      const client = createClient(AccountService, transport);
      return client.listAccounts(req);
    },
    reactivateAccount(req: any, context: any) {
      console.log("[Connect] Proxying reactivateAccount to account-manager");
      const transport = createDynamicTransport("account-manager");
      const client = createClient(AccountService, transport);
      return client.reactivateAccount(req);
    }
  });

  // Connector Admin Service proxy
  router.service(ConnectorAdminService, {
    registerConnector(req: any, context: any) {
      console.log("[Connect] Proxying registerConnector to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.registerConnector(req);
    },
    updateConnector(req: any, context: any) {
      console.log("[Connect] Proxying updateConnector to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.updateConnector(req);
    },
    getConnector(req: any, context: any) {
      console.log("[Connect] Proxying getConnector to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.getConnector(req);
    },
    listConnectors(req: any, context: any) {
      console.log("[Connect] Proxying listConnectors to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.listConnectors(req);
    },
    setConnectorStatus(req: any, context: any) {
      console.log("[Connect] Proxying setConnectorStatus to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.setConnectorStatus(req);
    },
    deleteConnector(req: any, context: any) {
      console.log("[Connect] Proxying deleteConnector to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.deleteConnector(req);
    },
    rotateApiKey(req: any, context: any) {
      console.log("[Connect] Proxying rotateApiKey to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.rotateApiKey(req);
    },
    getCrawlHistory(req: any, context: any) {
      console.log("[Connect] Proxying getCrawlHistory to connector-service");
      const transport = createDynamicTransport("connector-service");
      const client = createClient(ConnectorAdminService, transport);
      return client.getCrawlHistory(req);
    }
  });

  // gRPC Health proxy (platform-registration-service as first target)
  router.service(Health, {
    check(req, context) {
      console.log("[Health] Check request:", req);
      const targetBackend = context.requestHeader.get("x-target-backend");
      console.log("[Health] Target backend:", targetBackend);
      const transport = selectTransportFromHeader(targetBackend);
      const client = createClient(Health, transport);
      const response = client.check(req);
      console.log("[Health] Check response:", response);
      return response;
    },
    async *watch(req, context) {
      console.log("[Health] Watch request:", req);
      const targetBackend = context.requestHeader.get("x-target-backend");
      console.log("[Health] Watch target backend:", targetBackend);
      const transport = selectTransportFromHeader(targetBackend);
      const client = createClient(Health, transport);
      for await (const resp of client.watch(req)) {
        console.log("[Health] Watch response:", resp);
        yield resp;
      }
    }
  });
  
  console.log("Connect routes initialized with mapping service and platform registration proxy");
  
  return router;
};
