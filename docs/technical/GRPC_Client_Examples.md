# gRPC Client Code Examples

This document provides practical examples for making gRPC calls from both a Node.js backend (like the web-proxy) and a Vue.js frontend.

## Making gRPC Calls in Backend TypeScript (Node.js)

This pattern is used in the `platform-shell` backend to call other backend services.

### Non-Streaming Calls

```typescript
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { Health } from "@ai-pipestream/grpc-stubs/dist/grpc/health/v1/health_pb";

// Create transport to a specific backend service
const transport = createGrpcTransport({
  baseUrl: "http://localhost:38101",
  idleConnectionTimeoutMs: 1000 * 60 * 60  // Optional: 1 hour timeout for persistent connections
});

// Create a client for the target service
const client = createClient(Health, transport);

// Make the call
async function checkHealth() {
  try {
    const response = await client.check({});
    console.log("Service is healthy:", response.status);
    return response;
  } catch (error) {
    console.error("Health check failed:", error);
    throw error;
  }
}
```

### Using create() for Request Objects

For services with complex request types, use `create()` from `@bufbuild/protobuf`:

```typescript
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create } from "@bufbuild/protobuf";
import {
  PlatformRegistration,
  ServiceRegistrationRequestSchema
} from "@ai-pipestream/grpc-stubs/dist/registration/platform_registration_pb";

const transport = createGrpcTransport({
  baseUrl: "http://localhost:38101",
  idleConnectionTimeoutMs: 1000 * 60 * 60
});

const client = createClient(PlatformRegistration, transport);

async function registerService(serviceName: string, host: string, port: number) {
  const request = create(ServiceRegistrationRequestSchema, {
    serviceName,
    host,
    port,
    version: "1.0.0",
    tags: ["production"],
    capabilities: ["read", "write"]
  });

  try {
    const stream = client.registerService(request);
    for await (const event of stream) {
      console.log("Registration event:", event.message);
    }
  } catch (error) {
    console.error("Registration failed:", error);
    throw error;
  }
}
```

### Streaming Calls

```typescript
// Server streaming example
async function watchServices() {
  const stream = client.watchServices({});

  for await (const response of stream) {
    console.log("Services updated:", response.services.length);
    // Process each update
  }
}

// Example with an abort controller for cancellation
async function watchWithCancel() {
  const controller = new AbortController();

  // Cancel the stream after 30 seconds
  setTimeout(() => controller.abort(), 30000);

  try {
    const stream = client.watchServices(
      {},
      { signal: controller.signal }
    );

    for await (const response of stream) {
      console.log("Services:", response.services);
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.log("Stream was cancelled");
    } else {
      throw error;
    }
  }
}
```

## Making gRPC Calls in Vue TypeScript (Frontend)

This pattern is used in the various Vue.js applications to communicate with backend services through the platform-shell proxy.

### Setup - Singleton Client Pattern (Recommended)

Create a dedicated client file (e.g., `services/accountClient.ts`):

```typescript
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { create } from '@bufbuild/protobuf';
import {
  AccountService,
  CreateAccountRequestSchema,
  ListAccountsRequestSchema,
  type CreateAccountRequest,
  type ListAccountsRequest,
  type Account
} from '@ai-pipestream/grpc-stubs/dist/repository/account/account_service_pb';

// Create transport to platform-shell (which proxies to backend services)
// Uses window.location.origin so it works in dev and production
const transport = createConnectTransport({
  baseUrl: window.location.origin,
  useBinaryFormat: true  // Use binary protobuf for better performance
});

// Create and export the client
export const accountClient = createClient(AccountService, transport);

/**
 * Create a new account
 */
export async function createAccount(
  accountId: string,
  name: string,
  description?: string
): Promise<{ account: Account; created: boolean }> {
  const request = create(CreateAccountRequestSchema, {
    accountId,
    name,
    description: description || ''
  }) as CreateAccountRequest;

  const response = await accountClient.createAccount(request);
  return {
    account: response.account!,
    created: response.created
  };
}

/**
 * List accounts with optional filtering
 */
export async function listAccounts(options: {
  query?: string;
  includeInactive?: boolean;
  pageSize?: number;
  pageToken?: string;
} = {}) {
  const request = create(ListAccountsRequestSchema, {
    query: options.query ?? '',
    includeInactive: options.includeInactive ?? false,
    pageSize: options.pageSize ?? 50,
    pageToken: options.pageToken ?? ''
  }) as ListAccountsRequest;

  return accountClient.listAccounts(request);
}
```

### Using the Client in Vue Components

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { listAccounts, createAccount } from '@/services/accountClient';
import type { Account } from '@ai-pipestream/grpc-stubs/dist/repository/account/account_service_pb';

// Reactive data
const accounts = ref<Account[]>([]);
const loading = ref(false);
const error = ref<Error | null>(null);

// Fetch accounts when component mounts
onMounted(async () => {
  loading.value = true;
  try {
    const response = await listAccounts({ includeInactive: false });
    accounts.value = response.accounts;
  } catch (e) {
    error.value = e as Error;
    console.error('Failed to fetch accounts:', e);
  } finally {
    loading.value = false;
  }
});

// Create new account
const handleCreateAccount = async (accountId: string, name: string) => {
  try {
    const result = await createAccount(accountId, name);
    if (result.created) {
      accounts.value.push(result.account);
    }
  } catch (e) {
    console.error('Failed to create account:', e);
  }
};
</script>

<template>
  <v-card>
    <v-card-text>
      <div v-if="loading">Loading...</div>
      <div v-else-if="error" class="error">{{ error.message }}</div>
      <v-list v-else>
        <v-list-item v-for="account in accounts" :key="account.accountId">
          {{ account.name }}
        </v-list-item>
      </v-list>
    </v-card-text>
  </v-card>
</template>
```

### Streaming Calls in Vue (Composable Pattern)

Create a composable for managing streams (e.g., `composables/useServiceRegistry.ts`):

```typescript
import { ref } from 'vue';
import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import { PlatformRegistration } from '@ai-pipestream/grpc-stubs/dist/registration/platform_registration_pb';

const availableServices = ref<Set<string>>(new Set());

// Singleton controllers - only one stream for the entire app
let abortController: AbortController | null = null;
let isInitialized = false;

const initializeStream = () => {
  if (isInitialized) return;
  isInitialized = true;

  abortController = new AbortController();

  (async () => {
    try {
      const transport = createConnectTransport({
        baseUrl: window.location.origin,
        useBinaryFormat: true
      });

      const client = createClient(PlatformRegistration, transport);

      const stream = client.watchServices({}, {
        signal: abortController!.signal
      });

      for await (const response of stream) {
        const services = new Set<string>();
        for (const details of response.services) {
          if (details.isHealthy) {
            services.add(details.serviceName);
          }
        }
        availableServices.value = services;
      }
    } catch (error: any) {
      if (error?.name !== 'AbortError') {
        console.error('Failed to watch services:', error);
      }
    }
  })();
};

export function useServiceRegistry() {
  initializeStream();

  return {
    availableServices
  };
}
```

### Using the Streaming Composable in Components

```vue
<script setup lang="ts">
import { useServiceRegistry } from '@/composables/useServiceRegistry';

// This will start the stream on first call and reuse it
const { availableServices } = useServiceRegistry();
</script>

<template>
  <v-card>
    <v-card-title>Available Services</v-card-title>
    <v-card-text>
      <v-chip
        v-for="service in availableServices"
        :key="service"
        class="ma-1"
        color="success"
      >
        {{ service }}
      </v-chip>
    </v-card-text>
  </v-card>
</template>
```

## Key Points

### Frontend (Vue)
- **Always use `window.location.origin`** - Works in dev (proxied by Vite) and production
- **Always use `useBinaryFormat: true`** - Better performance than JSON
- **Create singleton clients** - Export client and helper functions from dedicated files
- **Use `create(Schema, {...})`** - For type-safe request object creation
- **Stream management** - Use composables with singleton abort controllers

### Backend (Node.js)
- **Use `createGrpcTransport`** - For Node.js server-to-server calls
- **Set timeout options** - `idleConnectionTimeoutMs` for persistent connections
- **Import from specific paths** - `@ai-pipestream/grpc-stubs/dist/path/to/service_pb`
- **Use `create(Schema, {...})`** - For complex request objects

### Both
- **Use AbortController** - For cancelling streams
- **Handle errors appropriately** - Check for `AbortError` when using cancellation
- **Use `for await...of`** - For consuming server streams
