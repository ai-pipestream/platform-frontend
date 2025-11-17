<template>
  <!-- Compact Mode -->
  <div v-if="compact" class="d-inline-flex align-center compact-health-status">
    <v-tooltip location="top">
      <template v-slot:activator="{ props: tooltipProps }">
        <div v-bind="tooltipProps" class="d-flex align-center cursor-pointer">
          <v-icon :color="healthInfo.color" :icon="healthInfo.icon" :size="compactSize" class="compact-icon" />
          <span v-if="!iconOnly" class="ml-1 text-caption">{{ healthInfo.compactText || healthInfo.text }}</span>
        </div>
      </template>
      <div>
        <div class="font-weight-bold">{{ props.serviceName }}</div>
        <div class="text-caption">Status: {{ healthInfo.text }}</div>
        <div v-if="props.target" class="text-caption">Target: {{ props.target }}</div>
        <div v-if="lastUpdatedAt" class="text-caption">
          Updated: {{ formatTimestamp(lastUpdatedAt) }}
        </div>
        <div v-if="error" class="text-caption error--text mt-1">
          Error: {{ error.message }}
        </div>
        <div v-if="reconnectAttempts > 0" class="text-caption">
          Reconnect attempts: {{ reconnectAttempts }}
        </div>
      </div>
    </v-tooltip>
  </div>

  <!-- Full Mode -->
  <div v-else class="d-flex align-center">
    <v-icon :color="healthInfo.color" :icon="healthInfo.icon" class="mr-2" />
    <span>{{ healthInfo.text }}</span>
    <v-tooltip v-if="error" activator="parent" location="top">
      {{ error.message }}
    </v-tooltip>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, watch, computed, shallowRef } from 'vue';
import { createClient, ConnectError, Code } from '@connectrpc/connect';
import { Health, HealthCheckResponse_ServingStatus as ServingStatus, type HealthCheckResponse } from '@ai-pipestream/grpc-stubs/dist/grpc/health/v1/health_pb';
import { createConnectTransport } from '@connectrpc/connect-web';

//##############################################################################
// 1. PROPS AND TYPES
//##############################################################################

export type HealthStatus = 'SERVING' | 'NOT_SERVING' | 'UNKNOWN' | 'CONNECTING' | 'ERROR';

export interface GrpcHealthStatusProps {
  serviceName: string;
  target?: string; // The new target prop
  autoReconnect?: boolean;
  initialBackoff?: number;
  maxBackoff?: number;
  compact?: boolean;
  iconOnly?: boolean;
  compactSize?: string | number;
}

const props = withDefaults(defineProps<GrpcHealthStatusProps>(), {
  autoReconnect: true,
  initialBackoff: 1000,
  maxBackoff: 30000,
  compact: false,
  iconOnly: false,
  compactSize: 'small',
});

//##############################################################################
// 2. GRPC CLIENT AND TRANSPORT SETUP
//##############################################################################

// Create a dynamic transport that reacts to the `target` prop
const transport = computed(() => {
  // Always use the default proxy URL, just add headers if target is specified
  const options = props.target
    ? { headers: { 'x-target-backend': props.target } }
    : {};

  return createConnectTransport({
    baseUrl: `http://${window.location.hostname}:38106`,
    useBinaryFormat: true,
    ...options
  });
});

// Create a dynamic client that reacts to the transport
const client = computed(() => createClient(Health, transport.value));


//##############################################################################
// 3. REACTIVE STATE AND CONNECTION LOGIC
//##############################################################################

const status = ref<HealthStatus>('CONNECTING');
const error = shallowRef<Error | null>(null);
const lastUpdatedAt = ref<Date | null>(null);
const reconnectAttempts = ref(0);
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
let abortController: AbortController | null = null;
let isUnmounted = false;
let hmrCleanup: (() => void) | null = null;

// HMR-aware cleanup: cleanup stream when module is hot-reloaded
if (import.meta.hot) {
  hmrCleanup = () => {
    console.log('[GrpcHealthStatus] HMR detected, cleaning up stream');
    isUnmounted = true;
    disconnect();
  };
  import.meta.hot.on('vite:beforeUpdate', hmrCleanup);
}

const connect = async () => {
  if (isUnmounted) return;

  disconnect();
  abortController = new AbortController();
  status.value = 'CONNECTING';
  error.value = null;

  try {
    console.log('[GrpcHealthStatus] Starting health watch for target:', props.target || 'default');

    // Use the computed client property
    // Note: Most gRPC health services only respond to empty service name for overall health
    // Watch streams should not timeout - they're meant to stay open
    const stream = client.value.watch(
      { service: "" },
      {
        signal: abortController.signal,
        timeoutMs: undefined // Disable timeout for streaming calls
      }
    );

    console.log('[GrpcHealthStatus] Stream created, waiting for responses...');

    for await (const response of stream) {
      console.log('[GrpcHealthStatus] Received health response:', response);
      reconnectAttempts.value = 0;
      lastUpdatedAt.value = new Date();
      switch ((response as HealthCheckResponse).status) {
        case ServingStatus.SERVING:
          status.value = 'SERVING';
          break;
        case ServingStatus.NOT_SERVING:
          status.value = 'NOT_SERVING';
          break;
        default:
          status.value = 'UNKNOWN';
          break;
      }
    }

    console.log('[GrpcHealthStatus] Stream ended');
    if (props.autoReconnect) {
      scheduleReconnect();
    }
  } catch (e) {
    console.error('[GrpcHealthStatus] Health watch error:', e);
    if (e instanceof ConnectError && e.code === Code.Canceled) {
      return;
    }
    error.value = e as Error;
    status.value = 'ERROR';
    lastUpdatedAt.value = new Date();
    if (props.autoReconnect) {
      scheduleReconnect();
    }
  }
};

const scheduleReconnect = () => {
  if (isUnmounted || !props.autoReconnect) return;
  const jitter = Math.random() * 500;
  const backoff = Math.min(props.initialBackoff * Math.pow(2, reconnectAttempts.value), props.maxBackoff) + jitter;
  reconnectAttempts.value++;
  reconnectTimeout = setTimeout(connect, backoff);
};

const disconnect = () => {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  abortController?.abort();
};

//##############################################################################
// 4. UI AND LIFECYCLE
//##############################################################################

const healthInfo = computed(() => {
  switch (status.value) {
    case 'SERVING':
      return {
        color: 'success',
        icon: 'mdi-check-circle',
        text: 'Healthy',
        compactText: 'Connected'
      };
    case 'NOT_SERVING':
      return {
        color: 'warning',
        icon: 'mdi-alert-circle',
        text: 'Not Serving',
        compactText: 'Disconnected'
      };
    case 'CONNECTING':
      return {
        color: 'info',
        icon: 'mdi-loading mdi-spin',
        text: 'Connecting...',
        compactText: 'Connecting'
      };
    case 'ERROR':
      return {
        color: 'error',
        icon: 'mdi-close-circle',
        text: 'Error',
        compactText: 'Error'
      };
    default:
      return {
        color: 'grey',
        icon: 'mdi-help-circle',
        text: 'Unknown',
        compactText: 'Unknown'
      };
  }
});

// Helper function to format timestamps
const formatTimestamp = (date: Date) => {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  if (diff < 1000) return 'just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return date.toLocaleTimeString();
};

// Watch for changes to the client (which happens when the target prop changes)
// and automatically reconnect.
watch(client, () => {
  console.log('[GrpcHealthStatus] Client changed, reconnecting...');
  connect();
}, { immediate: true }); // Add immediate: true to trigger on mount

onUnmounted(() => {
  console.log('[GrpcHealthStatus] Component unmounting, disconnecting...');
  isUnmounted = true;
  disconnect();

  // Cleanup HMR listener
  if (hmrCleanup && import.meta.hot) {
    import.meta.hot.off('vite:beforeUpdate', hmrCleanup);
    hmrCleanup = null;
  }
});

</script>

<style scoped>
.mdi-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.compact-health-status {
  cursor: pointer;
}

.compact-icon {
  transition: all 0.2s ease;
}

.compact-health-status:hover .compact-icon {
  transform: scale(1.1);
}
</style>