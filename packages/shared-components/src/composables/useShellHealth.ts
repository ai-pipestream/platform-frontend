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

export function useShellHealth() {
  const updates = shallowRef<Map<string, ServiceHealthUpdate>>(new Map())
  const isConnected = ref(false)
  const isUsingFallback = ref(false)
  const error = ref<string | null>(null)
  const reconnectAttempts = ref(0)

  let abortController = new AbortController()
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let isUnmounted = false

  const transport = createConnectTransport({
    baseUrl: window.location.origin,
    useBinaryFormat: true
  })
  const client = createClient(ShellService, transport)

  const fetchFallbackSnapshot = async (): Promise<void> => {
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
      
      updates.value = fallbackUpdates
      isUsingFallback.value = true
      error.value = null
      console.log(`[useShellHealth] Fallback loaded ${snapshot.services.length} services`)
    } catch (e: any) {
      console.error('[useShellHealth] Fallback fetch failed:', e)
      error.value = `Fallback failed: ${e?.message ?? String(e)}`
    }
  }

  const scheduleReconnect = (): void => {
    if (isUnmounted) return
    
    const baseDelay = 1000 // 1 second
    const maxDelay = 30000 // 30 seconds
    const backoffMultiplier = 1.5
    const jitter = Math.random() * 500
    
    const delay = Math.min(
      baseDelay * Math.pow(backoffMultiplier, reconnectAttempts.value),
      maxDelay
    ) + jitter
    
    console.log(`[useShellHealth] Scheduling reconnect attempt ${reconnectAttempts.value + 1} in ${Math.round(delay)}ms`)
    
    reconnectTimeout = setTimeout(() => {
      reconnectAttempts.value++
      startHealthStream()
    }, delay)
  }

  const startHealthStream = async (): Promise<void> => {
    if (isUnmounted) return

    // Clear previous connection
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
    
    abortController.abort()
    abortController = new AbortController()

    try {
      console.log(`[useShellHealth] Starting health stream (attempt ${reconnectAttempts.value + 1})`)
      isConnected.value = true
      isUsingFallback.value = false
      
      for await (const update of client.watchHealth({}, {
        signal: abortController.signal,
        timeoutMs: undefined
      })) {
        updates.value = new Map(updates.value).set(update.serviceName, update)
        reconnectAttempts.value = 0 // Reset on successful data
        error.value = null
      }
      
      console.log('[useShellHealth] Stream ended normally')
    } catch (e: any) {
      console.error('[useShellHealth] Stream error:', e)
      
      // Don't treat cancellation as an error
      if (e instanceof ConnectError && e.code === Code.Canceled) {
        return
      }
      
      error.value = `Stream error: ${e?.message ?? String(e)}`
      
      // Try fallback snapshot on stream failure
      await fetchFallbackSnapshot()
      
      // Schedule reconnect with exponential backoff
      scheduleReconnect()
    } finally {
      isConnected.value = false
    }
  }

  // Initial connection
  startHealthStream()

  onUnmounted(() => {
    console.log('[useShellHealth] Component unmounting')
    isUnmounted = true
    abortController.abort()
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
    }
  })

  const refresh = async (): Promise<void> => {
    console.log('[useShellHealth] Manual refresh requested')
    reconnectAttempts.value = 0
    await startHealthStream()
  }

  return { 
    updates, 
    isConnected, 
    isUsingFallback,
    error, 
    reconnectAttempts: readonly(reconnectAttempts),
    refresh
  }
}