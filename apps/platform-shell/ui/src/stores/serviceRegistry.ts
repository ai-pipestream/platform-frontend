import { defineStore } from 'pinia'
import { ref } from 'vue'
import { createClient, ConnectError, Code } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { PlatformRegistration } from '@ai-pipestream/grpc-stubs/dist/registration/platform_registration_pb.ts'

export const useServiceRegistryStore = defineStore('serviceRegistry', () => {
  // State
  const availableServices = ref<Set<string>>(new Set())
  const availableModules = ref<Set<string>>(new Set())

  // Stream state
  let serviceAbortController: AbortController | null = null
  let moduleAbortController: AbortController | null = null
  let isInitialized = false
  let isUnmounted = false

  // Watch services (streaming)
  const startServiceStream = async (): Promise<void> => {
    if (isUnmounted) return

    // Cancel previous stream
    if (serviceAbortController) {
      serviceAbortController.abort()
    }
    serviceAbortController = new AbortController()

    try {
      console.log('[ServiceRegistry] Starting service stream...')
      const transport = createConnectTransport({
        baseUrl: window.location.origin,
        useBinaryFormat: true
      })

      const client = createClient(PlatformRegistration, transport)

      for await (const response of client.watchServices({}, {
        signal: serviceAbortController.signal,
        timeoutMs: undefined
      })) {
        const services = new Set<string>()
        for (const details of response.services) {
          if (details.isHealthy) {
            services.add(details.serviceName)
          }
        }

        // Only update and log if services actually changed
        const current = availableServices.value
        const hasChanged =
          services.size !== current.size ||
          Array.from(services).some(s => !current.has(s))

        if (hasChanged) {
          availableServices.value = services
          console.log('[ServiceRegistry] Services updated:', Array.from(services))
        }
      }

      console.log('[ServiceRegistry] Service stream ended')
    } catch (error: any) {
      // Don't log canceled errors (expected during cleanup)
      if (error instanceof ConnectError && error.code === Code.Canceled) {
        console.log('[ServiceRegistry] Service stream canceled')
        return
      }

      console.error('[ServiceRegistry] Service stream error:', error)

      // Retry with exponential backoff
      if (!isUnmounted) {
        const delay = 5000 // 5 seconds
        console.log(`[ServiceRegistry] Retrying service stream in ${delay}ms...`)
        setTimeout(() => startServiceStream(), delay)
      }
    }
  }

  // Watch modules (streaming)
  const startModuleStream = async (): Promise<void> => {
    if (isUnmounted) return

    // Cancel previous stream
    if (moduleAbortController) {
      moduleAbortController.abort()
    }
    moduleAbortController = new AbortController()

    try {
      console.log('[ServiceRegistry] Starting module stream...')
      const transport = createConnectTransport({
        baseUrl: window.location.origin,
        useBinaryFormat: true
      })

      const client = createClient(PlatformRegistration, transport)

      for await (const response of client.watchModules({}, {
        signal: moduleAbortController.signal,
        timeoutMs: undefined
      })) {
        const modules = new Set<string>()
        for (const details of response.modules) {
          if (details.isHealthy) {
            modules.add(details.moduleName)
          }
        }

        // Only update and log if modules actually changed
        const current = availableModules.value
        const hasChanged =
          modules.size !== current.size ||
          Array.from(modules).some(m => !current.has(m))

        if (hasChanged) {
          availableModules.value = modules
          console.log('[ServiceRegistry] Modules updated:', Array.from(modules))
        }
      }

      console.log('[ServiceRegistry] Module stream ended')
    } catch (error: any) {
      // Don't log canceled errors (expected during cleanup)
      if (error instanceof ConnectError && error.code === Code.Canceled) {
        console.log('[ServiceRegistry] Module stream canceled')
        return
      }

      console.error('[ServiceRegistry] Module stream error:', error)

      // Retry with exponential backoff
      if (!isUnmounted) {
        const delay = 5000 // 5 seconds
        console.log(`[ServiceRegistry] Retrying module stream in ${delay}ms...`)
        setTimeout(() => startModuleStream(), delay)
      }
    }
  }

  // Actions
  const initializeStreams = () => {
    if (isInitialized) {
      console.log('[ServiceRegistry] Already initialized, skipping')
      return // Already initialized
    }
    isInitialized = true
    console.log('[ServiceRegistry] Initializing streams...')

    // Start both streams (real-time)
    startServiceStream()
    startModuleStream()
  }

  const cleanup = () => {
    console.log('[ServiceRegistry] Cleaning up streams')
    isUnmounted = true

    // Cancel service stream
    if (serviceAbortController) {
      serviceAbortController.abort()
      serviceAbortController = null
    }

    // Cancel module stream
    if (moduleAbortController) {
      moduleAbortController.abort()
      moduleAbortController = null
    }

    isInitialized = false
  }

  // Auto-initialize when store is first created
  initializeStreams()

  return {
    // State
    availableServices,
    availableModules,

    // Actions
    initializeStreams,
    cleanup,
  }
})
