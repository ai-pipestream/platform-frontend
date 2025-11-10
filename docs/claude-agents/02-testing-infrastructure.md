# Task: Create Testing Infrastructure

## Objective
Build a comprehensive testing infrastructure with examples and patterns that frontend developers can follow to test Vue components, gRPC integrations, and streaming functionality.

## Context

**Current State:**
- Almost all packages show `"test": "echo 'No tests yet'"`
- No test examples or patterns to follow
- No testing utilities or fixtures
- vitest is installed in some packages but not configured

**Tech Stack:**
- Vue 3 with Composition API
- TypeScript strict mode
- gRPC/Connect-ES with streaming
- Pinia stores for state management
- Vuetify components

**Testing Challenges:**
- Need to mock gRPC streaming responses
- Binary protobuf format makes testing harder
- AbortController cleanup in streams
- Reactive state with Pinia stores
- Vuetify component testing

## Requirements

### 1. Test Framework Setup

**Configure Vitest in all packages:**
- Add vitest.config.ts to each package that needs tests
- Configure Vue plugin for component testing
- Set up coverage reporting
- Add test scripts to package.json files

**Example vitest.config.ts:**
```typescript
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: 'jsdom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html']
    }
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  }
})
```

### 2. Testing Utilities Library

**Create `packages/test-utils/` package:**

**Mock gRPC Clients:**
```typescript
// packages/test-utils/src/grpc-mocks.ts

import { createClient } from '@connectrpc/connect'
import type { ServiceType } from '@bufbuild/protobuf'

/**
 * Creates a mock gRPC client for testing
 * Returns a client with all methods as vi.fn() mocks
 */
export function createMockClient<T extends ServiceType>(
  service: T,
  mockImplementations?: Partial<Record<string, any>>
) {
  // Implementation that creates vitest mocks for all service methods
}

/**
 * Creates a mock streaming response
 */
export async function* createMockStream<T>(items: T[], delayMs = 0) {
  for (const item of items) {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs))
    yield item
  }
}

/**
 * Mock transport for testing
 */
export const mockTransport = {
  baseUrl: 'http://localhost:38106',
  useBinaryFormat: true
}
```

**Mock Store Setup:**
```typescript
// packages/test-utils/src/store-utils.ts

import { setActivePinia, createPinia } from 'pinia'

/**
 * Setup Pinia for testing
 */
export function setupTestPinia() {
  const pinia = createPinia()
  setActivePinia(pinia)
  return pinia
}
```

**Component Test Helpers:**
```typescript
// packages/test-utils/src/component-utils.ts

import { mount } from '@vue/test-utils'
import { createVuetify } from 'vuetify'

/**
 * Mount a Vue component with Vuetify
 */
export function mountWithVuetify(component: any, options = {}) {
  const vuetify = createVuetify()
  return mount(component, {
    global: {
      plugins: [vuetify],
      ...options.global
    },
    ...options
  })
}
```

### 3. Example Tests

**A. Unit Test - Service Client**

Create `apps/platform-shell/ui/src/services/account-manager/src/services/accountClient.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createMockClient, createMockStream } from '@ai-pipestream/test-utils'
import { AccountService } from '@ai-pipestream/grpc-stubs/account'
import * as accountClient from './accountClient'

describe('Account Client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should create an account successfully', async () => {
    // Mock the gRPC client response
    const mockResponse = {
      account: {
        accountId: 'test-123',
        name: 'Test Account',
        description: 'Test Description'
      },
      created: true
    }

    // Test the client method
    const result = await accountClient.createAccount('test-123', 'Test Account', 'Test Description')

    expect(result).toEqual(mockResponse)
    expect(result.created).toBe(true)
  })

  it('should handle errors gracefully', async () => {
    // Test error handling
  })
})
```

**B. Integration Test - Streaming Store**

Create `apps/platform-shell/ui/src/stores/serviceRegistry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupTestPinia, createMockStream } from '@ai-pipestream/test-utils'
import { useServiceRegistryStore } from './serviceRegistry'

describe('Service Registry Store', () => {
  beforeEach(() => {
    setupTestPinia()
  })

  afterEach(() => {
    const store = useServiceRegistryStore()
    store.cleanup()
  })

  it('should update available services from stream', async () => {
    const store = useServiceRegistryStore()

    // Mock the streaming response
    const mockServices = [
      { serviceName: 'service-1', isHealthy: true },
      { serviceName: 'service-2', isHealthy: true }
    ]

    // Test that services are populated
    await store.initializeStreams()

    // Give streams time to process
    await new Promise(r => setTimeout(r, 100))

    expect(store.availableServices.size).toBeGreaterThan(0)
  })

  it('should handle stream errors and reconnect', async () => {
    // Test reconnection logic
  })
})
```

**C. Component Test - Health Status**

Create `packages/shared-components/src/components/GrpcHealthStatus.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mountWithVuetify } from '@ai-pipestream/test-utils'
import GrpcHealthStatus from './GrpcHealthStatus.vue'

describe('GrpcHealthStatus Component', () => {
  it('should render connecting state initially', () => {
    const wrapper = mountWithVuetify(GrpcHealthStatus, {
      props: {
        serviceName: 'test-service'
      }
    })

    expect(wrapper.text()).toContain('Connecting')
    expect(wrapper.find('.v-icon').classes()).toContain('mdi-loading')
  })

  it('should show healthy state when service is serving', async () => {
    // Mock streaming health response
    // Test state transitions
  })

  it('should reconnect on error with exponential backoff', async () => {
    // Test reconnection logic
  })

  it('should cleanup stream on unmount', () => {
    const wrapper = mountWithVuetify(GrpcHealthStatus, {
      props: { serviceName: 'test' }
    })

    wrapper.unmount()

    // Verify AbortController.abort() was called
  })
})
```

**D. E2E Test Example (Optional)**

Create `apps/platform-shell/ui/tests/e2e/health-page.spec.ts` (if using Playwright):

```typescript
import { test, expect } from '@playwright/test'

test('health page shows service status', async ({ page }) => {
  await page.goto('http://localhost:33000/health')

  // Should show health indicators
  await expect(page.locator('[data-testid="health-status"]')).toBeVisible()

  // Should show at least platform-registration-service
  await expect(page.getByText('platform-registration-service')).toBeVisible()
})
```

### 4. Mock Data Factories

**Create `packages/test-utils/src/factories/`:**

```typescript
// factories/account.factory.ts
import type { Account } from '@ai-pipestream/grpc-stubs/account'

export function createMockAccount(overrides?: Partial<Account>): Account {
  return {
    accountId: 'test-account-id',
    name: 'Test Account',
    description: 'Test Description',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides
  }
}

// factories/service.factory.ts
export function createMockServiceDetails(overrides?: Partial<ServiceDetails>) {
  return {
    serviceName: 'test-service',
    serviceType: 'TEST',
    version: '1.0.0',
    isHealthy: true,
    capabilities: [],
    tags: [],
    metadata: {},
    ...overrides
  }
}
```

### 5. Testing Documentation

**Create `docs/TESTING_GUIDE.md`:**

**Sections:**
- Running tests (`pnpm test`, `pnpm test:watch`, `pnpm test:coverage`)
- Writing your first test
- Testing gRPC clients (mocking)
- Testing streaming responses
- Testing Vue components with Vuetify
- Testing Pinia stores
- Debugging test failures
- CI/CD integration

**Testing Best Practices:**
- Arrange-Act-Assert pattern
- One assertion per test (where possible)
- Descriptive test names
- Clean up resources (streams, timers)
- Mock external dependencies
- Test error cases, not just happy path

### 6. Coverage Goals

**Target Coverage (don't aim for 100%, be pragmatic):**
- Service clients: 70%+ (critical business logic)
- Stores: 60%+ (state management)
- Composables: 70%+ (reusable logic)
- Components: 50%+ (UI can be tested visually)
- Utilities: 80%+ (pure functions)

**Priority Testing:**
1. gRPC service clients (high impact)
2. Streaming logic with reconnection (complex)
3. Store state mutations (bugs hide here)
4. Form validation and submission
5. Error handling and fallbacks

### 7. Package-Specific Test Setup

**For each package that needs tests:**

`packages/shared-components/`:
- Component rendering tests
- Props and events tests
- Vuetify integration tests

`packages/connector-shared/`:
- DocumentStreamer unit tests
- Buffer handling tests
- Stream chunking tests

`packages/protobuf-forms/`:
- Schema generation tests
- Form validation tests
- JSONForms integration tests

`apps/platform-shell/ui/`:
- Service client integration tests
- Store tests
- Composable tests
- Route guard tests

`apps/platform-shell/` (backend):
- Connect route handler tests
- Service resolver tests
- Proxy logic tests

## Deliverables

1. **Test Utilities Package** (`packages/test-utils/`)
   - Mock factories for all proto types
   - gRPC client mocking utilities
   - Component mounting helpers
   - Store setup utilities

2. **Example Tests** (at least 10-15 test files covering):
   - 3 service client tests
   - 2 store tests
   - 3 component tests
   - 1 composable test
   - 1 streaming pattern test
   - 1 error handling test

3. **Testing Guide** (`docs/TESTING_GUIDE.md`)
   - How to run tests
   - How to write tests
   - Patterns and examples
   - Troubleshooting

4. **Updated package.json files:**
   - Replace `"test": "echo 'No tests yet'"` with actual test commands
   - Add test:watch and test:coverage scripts

5. **CI Integration:**
   - Update GitHub Actions to run tests
   - Add test coverage reporting
   - Fail builds on test failures

## Success Criteria

- [ ] Every package has at least 2-3 example tests
- [ ] Test coverage runs and reports results
- [ ] All example tests pass
- [ ] Mock utilities work for gRPC clients and streams
- [ ] Documentation explains how to test common patterns
- [ ] CI/CD runs tests before Docker build
- [ ] Developers can copy-paste test examples and modify them

## Notes

- Use vitest (already installed in some packages)
- Use @vue/test-utils for component testing
- Consider happy-dom or jsdom for DOM environment
- Mock gRPC streams with async generators
- Don't over-test - focus on critical paths
- Make examples simple and clear

## Out of Scope

- 100% code coverage (unrealistic)
- E2E tests with real backend (too brittle for CI)
- Visual regression testing (future enhancement)
- Performance benchmarking tests

## Validation Steps

1. Run `pnpm -r test` - all tests should pass
2. Run `pnpm -r test:coverage` - see coverage report
3. Try copying an example test and modifying it - should be easy
4. Verify mocks work for gRPC clients
5. Check that CI runs tests successfully
