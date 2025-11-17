import { ref, shallowRef, onUnmounted, readonly } from 'vue'
import { createClient, ConnectError, Code } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { create } from '@bufbuild/protobuf'
import { ShellService, type ServiceHealthUpdate, ServiceHealthUpdateSchema } from '@ai-pipestream/grpc-stubs/dist/frontend/shell_service_pb'
import { HealthCheckResponse_ServingStatus as ServingStatus } from '@ai-pipestream/grpc-stubs/dist/grpc/health/v1/health_pb'

interface HealthSnapshot {
  services: Array<{
    name: string
    status: string
    target: string
    error: string | null
  }>
  checkedAt: string
}

// Singleton instance to prevent multiple streams during HMR
class ShellHealthManager {
  private updates = shallowRef<Map<string, ServiceHealthUpdate>>(new Map())
  private isConnected = ref(false)
  private isUsingFallback = ref(false)
  private error = ref<string | null>(null)
  private reconnectAttempts = ref(0)
  
  private abortController: AbortController | null = null
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  private referenceCount = 0
  private streamPromise: Promise<void> | null = null
  
  private transport = createConnectTransport({
    baseUrl: window.location.origin,
    useBinaryFormat: true
  })
  private client = createClient(ShellService, this.transport)

  // HMR-aware cleanup: if module is being hot-reloaded, cleanup immediately
  private isHMRReloading = false
  private hmrCleanup: (() => void) | null = null

  constructor() {
    // Handle Vite HMR: cleanup on module reload
    if (import.meta.hot) {
      this.hmrCleanup = () => {
        console.log('[useShellHealth] HMR detected, cleaning up singleton')
        this.isHMRReloading = true
        this.cleanup()
      }
      import.meta.hot.on('vite:beforeUpdate', this.hmrCleanup)
    }
  }

  private async fetchFallbackSnapshot(): Promise<void> {
    try {
      console.log('[useShellHealth] Fetching fallback health snapshot')
      const response = await fetch('/connect/system/health-snapshot')
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }
      
      const snapshot: HealthSnapshot = await response.json()
      const fallbackUpdates = new Map<string, ServiceHealthUpdate>()
      
      for (const service of snapshot.services) {
        let status: ServingStatus
        switch (service.status.toLowerCase()) {
          case 'serving':
            status = ServingStatus.SERVING
            break
          case 'not_serving':
            status = ServingStatus.NOT_SERVING
            break
          default:
            status = ServingStatus.UNKNOWN
            break
        }

        fallbackUpdates.set(service.name, create(ServiceHealthUpdateSchema, {
          serviceName: service.name,
          displayName: service.name,
          target: service.target,
          status,
          observedAt: snapshot.checkedAt
        }) as ServiceHealthUpdate)
      }
      
      this.updates.value = fallbackUpdates
      this.isUsingFallback.value = true
      this.error.value = null
      console.log(`[useShellHealth] Fallback loaded ${snapshot.services.length} services`)
    } catch (e: any) {
      console.error('[useShellHealth] Fallback fetch failed:', e)
      this.error.value = `Fallback failed: ${e?.message ?? String(e)}`
    }
  }

  private scheduleReconnect(): void {
    if (this.isHMRReloading || this.referenceCount === 0) return
    
    const baseDelay = 1000 // 1 second
    const maxDelay = 30000 // 30 seconds
    const backoffMultiplier = 1.5
    const jitter = Math.random() * 500
    
    const delay = Math.min(
      baseDelay * Math.pow(backoffMultiplier, this.reconnectAttempts.value),
      maxDelay
    ) + jitter
    
    console.log(`[useShellHealth] Scheduling reconnect attempt ${this.reconnectAttempts.value + 1} in ${Math.round(delay)}ms`)
    
    this.reconnectTimeout = setTimeout(() => {
      if (!this.isHMRReloading && this.referenceCount > 0) {
        this.reconnectAttempts.value++
        this.startHealthStream()
      }
    }, delay)
  }

  private async startHealthStream(): Promise<void> {
    if (this.isHMRReloading || this.referenceCount === 0) return

    // Clear previous connection
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    
    if (this.abortController) {
      this.abortController.abort()
    }
    this.abortController = new AbortController()

    try {
      console.log(`[useShellHealth] Starting health stream (attempt ${this.reconnectAttempts.value + 1}, refs: ${this.referenceCount})`)
      this.isConnected.value = true
      this.isUsingFallback.value = false
      
      for await (const update of this.client.watchHealth({}, {
        signal: this.abortController.signal,
        timeoutMs: undefined
      })) {
        // Check if we should continue (HMR or no references)
        if (this.isHMRReloading || this.referenceCount === 0) {
          console.log('[useShellHealth] Stopping stream due to HMR or no references')
          break
        }
        
        this.updates.value = new Map(this.updates.value).set(update.serviceName, update)
        this.reconnectAttempts.value = 0 // Reset on successful data
        this.error.value = null
      }
      
      console.log('[useShellHealth] Stream ended normally')
    } catch (e: any) {
      console.error('[useShellHealth] Stream error:', e)
      
      // Don't treat cancellation as an error
      if (e instanceof ConnectError && e.code === Code.Canceled) {
        console.log('[useShellHealth] Stream canceled (expected during refresh/unmount/HMR)')
        return
      }
      
      // Only set error and reconnect if we still have references and aren't HMR reloading
      if (!this.isHMRReloading && this.referenceCount > 0) {
        this.error.value = `Stream error: ${e?.message ?? String(e)}`
        
        // Try fallback snapshot on stream failure
        await this.fetchFallbackSnapshot()
        
        // Schedule reconnect with exponential backoff
        this.scheduleReconnect()
      }
    } finally {
      this.isConnected.value = false
    }
  }

  private cleanup(): void {
    console.log(`[useShellHealth] Cleaning up (refs: ${this.referenceCount})`)
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    
    // Cleanup HMR listener
    if (this.hmrCleanup && import.meta.hot) {
      import.meta.hot.off('vite:beforeUpdate', this.hmrCleanup)
      this.hmrCleanup = null
    }
  }

  // Public API
  addReference(): {
    updates: typeof this.updates
    isConnected: typeof this.isConnected
    isUsingFallback: typeof this.isUsingFallback
    error: typeof this.error
    reconnectAttempts: ReturnType<typeof readonly<typeof this.reconnectAttempts.value>>
    refresh: () => Promise<void>
    removeReference: () => void
  } {
    this.referenceCount++
    console.log(`[useShellHealth] Added reference (total: ${this.referenceCount})`)
    
    // Start stream if this is the first reference
    if (this.referenceCount === 1 && !this.streamPromise) {
      this.isHMRReloading = false // Reset HMR flag on new instance
      this.streamPromise = this.startHealthStream()
    }
    
    return {
      updates: this.updates,
      isConnected: this.isConnected,
      isUsingFallback: this.isUsingFallback,
      error: this.error,
      reconnectAttempts: readonly(this.reconnectAttempts),
      refresh: async () => {
        console.log('[useShellHealth] Manual refresh requested')
        this.reconnectAttempts.value = 0
        await this.startHealthStream()
      },
      removeReference: () => {
        this.referenceCount--
        console.log(`[useShellHealth] Removed reference (total: ${this.referenceCount})`)
        
        // Only cleanup if no more references
        if (this.referenceCount === 0) {
          this.cleanup()
          this.streamPromise = null
        }
      }
    }
  }
}

// Singleton instance
const healthManager = new ShellHealthManager()

export function useShellHealth() {
  const api = healthManager.addReference()
  
  onUnmounted(() => {
    console.log('[useShellHealth] Component unmounting')
    api.removeReference()
  })

  return {
    updates: api.updates,
    isConnected: api.isConnected,
    isUsingFallback: api.isUsingFallback,
    error: api.error,
    reconnectAttempts: api.reconnectAttempts,
    refresh: api.refresh
  }
}