# Task: Auto-Start Complete Build Environment

## Objective
Create an automated setup that a Claude agent can execute to start the entire platform-frontend development environment from scratch, including all required backend services.

## Architecture Philosophy

**By Design: Instant Infrastructure for Developers**

The platform is architected to get frontend developers productive IMMEDIATELY:

1. **Published Dependencies:**
   - `@ai-pipestream/grpc-stubs` is published to npm (no local build needed)
   - Backend libraries published to Maven Central (versioned releases)

2. **Docker-Managed Infrastructure:**
   - `platform-registration-service` handles all backend infrastructure via Docker
   - Consul, OpenSearch, and other services start automatically
   - No complex setup required

3. **🚧 TODO - Future Enhancement (Not Yet Implemented):**
   - **Pre-built Docker Images:** Eventually `platform-registration-service` and ALL infrastructure will be published as Docker images to Docker Hub / ghcr.io
   - **One Command Setup:** Developers will run: `docker compose up` and the ENTIRE backend infrastructure starts instantly
   - **Zero Backend Knowledge:** Frontend devs won't need Java, Gradle, or any backend tools
   - **Current State:** Still need to build platform-registration-service locally (but it handles everything else via Docker)

**What This Means Today:**
- ✅ Clone platform-registration-service → Gradle pulls ALL backend JARs from Maven Central
- ✅ Run startup script → Docker brings up infrastructure (Consul, etc.)
- ✅ Clone platform-frontend → npm pulls grpc-stubs from npm registry
- ✅ Ready to develop frontend with full backend running

**What This Will Mean (Future - Docker Hub Images):**
- Clone platform-frontend only
- Run `docker compose up`
- Pre-built platform-registration-service image pulls from Docker Hub
- Infrastructure auto-downloads and starts
- Frontend ready in < 5 minutes with ZERO backend tools needed

## Context

**Current Manual Process:**
1. User manually starts platform-registration-service (Java/Gradle)
2. User manually starts platform-shell backend (Node/Express)
3. User manually starts platform-shell UI (Vite dev server)
4. User ensures correct ports and environment variables
5. User troubleshoots if anything is misconfigured

**Desired Automated Process:**
1. Agent reads this file
2. Agent executes all setup steps automatically
3. Agent verifies everything is running
4. Agent reports status and URLs
5. Developer can immediately start coding

## Prerequisites (Agent Should Verify)

**Required Software:**
- Node.js 22.x (check: `node --version`)
- pnpm 10.x (check: `pnpm --version`)
- Java 21+ (check: `java --version`)
- Gradle (check: `./gradlew --version` or `gradle --version`)
- Docker (optional, check: `docker --version`)

**Required Repositories:**

**For Frontend Development (Simplest Approach):**

Clone ONLY ONE repository:
```bash
# Create workspace directory
mkdir -p ~/IdeaProjects/ai-pipestream
cd ~/IdeaProjects/ai-pipestream

# Clone platform-registration-service (this brings up EVERYTHING)
git clone https://github.com/ai-pipestream/platform-registration-service.git
```

**Why only one repo?**
- ✅ **ALL backend JARs published to Maven Central** - No need to build anything locally
- ✅ **grpc-stubs published to npm** - Frontend gets it automatically
- ✅ **Docker Compose included** - Starts all infrastructure services (Consul, OpenSearch, etc.)
- ✅ **Gradle pulls dependencies** - From Maven Central, not local builds

**The platform-registration-service:**
1. Downloads all dependencies from Maven Central
2. Starts itself (port 38101)
3. Starts Docker infrastructure via its docker-compose.yml
4. Acts as service registry for all other services

Then you just need to clone platform-frontend separately to develop the UI.

**Full Setup:**
```bash
# 1. Clone and start backend infrastructure
git clone https://github.com/ai-pipestream/platform-registration-service.git
cd platform-registration-service
./scripts/start-dev.sh   # Pulls Maven Central deps, starts Docker, starts service

# 2. Clone frontend (in separate terminal/directory)
cd ~/IdeaProjects/ai-pipestream
git clone https://github.com/ai-pipestream/platform-frontend.git
cd platform-frontend
pnpm install            # Pulls grpc-stubs from npm
pnpm -r build           # Build frontend packages
# Then start backend and UI (see steps below)
```

**For Full-Stack Development (Backend Library Changes):**
Only needed if modifying grpc-stubs or platform-libraries:
- Clone `https://github.com/ai-pipestream/platform-libraries`
- Build and publish to Maven local
- Configure platform-registration-service to use Maven local
- See platform-libraries/grpc/UPDATING_GRPC_STUBS.md

**Port Availability:**
Agent should check these ports are free:
- 38101 - platform-registration-service (gRPC)
- 38106 - platform-shell backend (Express + Connect)
- 33000 - platform-shell UI (Vite dev server)

## Step-by-Step Startup Sequence

### Step 1: Verify Prerequisites

```bash
# Check Node.js version
node --version | grep -E "v22\."
if [ $? -ne 0 ]; then
  echo "ERROR: Node.js 22.x required"
  exit 1
fi

# Check pnpm
pnpm --version | grep -E "^10\."
if [ $? -ne 0 ]; then
  echo "ERROR: pnpm 10.x required"
  exit 1
fi

# Check Java
java --version | grep -E "version \"2[1-9]"
if [ $? -ne 0 ]; then
  echo "ERROR: Java 21+ required"
  exit 1
fi

# Check ports are available
lsof -i :38101 >/dev/null 2>&1 && echo "WARNING: Port 38101 already in use"
lsof -i :38106 >/dev/null 2>&1 && echo "WARNING: Port 38106 already in use"
lsof -i :33000 >/dev/null 2>&1 && echo "WARNING: Port 33000 already in use"
```

### Step 2: Platform Registration Service (Backend)

**Location:** `~/IdeaProjects/ai-pipestream/platform-registration-service`

**This service does TWO things:**
1. Provides gRPC service discovery and registration
2. Manages Docker infrastructure (automatically starts other backend services)

```bash
cd ~/IdeaProjects/ai-pipestream/platform-registration-service

# Pull latest changes
git pull origin main

# The platform-registration-service has a startup script that:
# - Builds the service
# - Starts Docker infrastructure (Consul, other services)
# - Starts the registration service itself
./scripts/start-dev.sh > /tmp/platform-registration.log 2>&1 &
REGISTRATION_PID=$!
echo "Started platform-registration-service with infrastructure (PID: $REGISTRATION_PID)"

# Wait for service to be ready (check gRPC health)
echo "Waiting for platform-registration-service to be ready..."
for i in {1..60}; do
  grpcurl -plaintext -d '{"service":""}' localhost:38101 grpc.health.v1.Health/Check >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "✓ platform-registration-service is healthy"
    break
  fi
  echo "Attempt $i/60: Waiting for platform-registration-service and infrastructure..."
  sleep 2
done

# Verify it's actually running
grpcurl -plaintext -d '{"service":""}' localhost:38101 grpc.health.v1.Health/Check || {
  echo "ERROR: platform-registration-service failed to start"
  echo "Logs:"
  tail -50 /tmp/platform-registration.log
  exit 1
}

# Verify infrastructure services are registered
echo "Checking registered services..."
grpcurl -plaintext -d '{}' localhost:38101 ai.pipestream.platform.registration.PlatformRegistration/ListServices | \
  jq -r '.services[].serviceName' | head -10
```

**Note:** The platform-registration-service uses Docker Compose internally to start:
- Consul (service mesh)
- Other backend services as needed
- All configured to register with platform-registration automatically

### Step 3: Platform Frontend - Install Dependencies

**Location:** `~/IdeaProjects/ai-pipestream/platform-frontend`

```bash
cd ~/IdeaProjects/ai-pipestream/platform-frontend

# Pull latest changes
git pull origin main

# Install dependencies
pnpm install

# Build all packages (not apps)
pnpm --filter "./packages/*" build

# Verify builds succeeded
ls packages/shared-components/dist/ >/dev/null 2>&1 || {
  echo "ERROR: shared-components build failed"
  exit 1
}

ls packages/shared-nav/dist/ >/dev/null 2>&1 || {
  echo "ERROR: shared-nav build failed"
  exit 1
}
```

### Step 4: Platform Shell Backend (Web Proxy)

```bash
cd ~/IdeaProjects/ai-pipestream/platform-frontend/apps/platform-shell

# Build backend TypeScript
pnpm run build

# Set environment variables
export PORT=38106
export PLATFORM_REGISTRATION_HOST=localhost
export PLATFORM_REGISTRATION_PORT=38101
export NODE_ENV=development

# Start backend in background
node dist/index.js > /tmp/platform-shell-backend.log 2>&1 &
BACKEND_PID=$!
echo "Started platform-shell backend (PID: $BACKEND_PID)"

# Wait for backend to be ready
echo "Waiting for platform-shell backend to be ready..."
for i in {1..20}; do
  curl -f http://localhost:38106/proxy/health >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "✓ platform-shell backend is healthy"
    break
  fi
  echo "Attempt $i/20: Waiting for backend..."
  sleep 1
done

# Verify backend is running
curl -f http://localhost:38106/proxy/health || {
  echo "ERROR: platform-shell backend failed to start"
  echo "Logs:"
  tail -50 /tmp/platform-shell-backend.log
  exit 1
}
```

### Step 5: Platform Shell UI (Vite Dev Server)

```bash
cd ~/IdeaProjects/ai-pipestream/platform-frontend/apps/platform-shell/ui

# Set environment variables
export VITE_BACKEND_URL=http://localhost:38106
export VITE_DEV_SERVER_PORT=33000

# Start Vite dev server in background
pnpm run dev > /tmp/platform-shell-ui.log 2>&1 &
UI_PID=$!
echo "Started platform-shell UI (PID: $UI_PID)"

# Wait for Vite to be ready
echo "Waiting for Vite dev server to be ready..."
for i in {1..30}; do
  curl -f http://localhost:33000/ >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "✓ Vite dev server is ready"
    break
  fi
  echo "Attempt $i/30: Waiting for Vite..."
  sleep 1
done

# Verify UI is serving
curl -f http://localhost:33000/ || {
  echo "ERROR: Vite dev server failed to start"
  echo "Logs:"
  tail -50 /tmp/platform-shell-ui.log
  exit 1
}
```

### Step 6: Verification and Status Report

```bash
echo ""
echo "=========================================="
echo "✓ Build Environment Ready!"
echo "=========================================="
echo ""
echo "Services Running:"
echo "  - Platform Registration:  http://localhost:38101 (gRPC)"
echo "  - Platform Shell Backend: http://localhost:38106"
echo "  - Platform Shell UI:      http://localhost:33000"
echo ""
echo "Process IDs:"
echo "  - platform-registration-service: $REGISTRATION_PID"
echo "  - platform-shell backend:        $BACKEND_PID"
echo "  - platform-shell UI:             $UI_PID"
echo ""
echo "Quick Tests:"
echo ""

# Test platform-registration gRPC
echo "1. Testing platform-registration-service..."
grpcurl -plaintext -d '{}' localhost:38101 ai.pipestream.platform.registration.PlatformRegistration/ListServices | jq '.services | length'
echo "   ✓ Responding to gRPC calls"

# Test backend proxy
echo "2. Testing platform-shell backend..."
curl -s http://localhost:38106/api/system-status | jq '.proxy.status'
echo "   ✓ Backend proxy is healthy"

# Test UI
echo "3. Testing platform-shell UI..."
curl -s http://localhost:33000/ | grep -q "<!DOCTYPE html>" && echo "   ✓ UI is serving HTML"

echo ""
echo "Development URLs:"
echo "  🌐 Frontend: http://localhost:33000"
echo "  🔧 Backend:  http://localhost:38106"
echo "  📊 Health:   http://localhost:33000/health"
echo ""
echo "Logs:"
echo "  tail -f /tmp/platform-registration.log"
echo "  tail -f /tmp/platform-shell-backend.log"
echo "  tail -f /tmp/platform-shell-ui.log"
echo ""
echo "To stop all services:"
echo "  kill $REGISTRATION_PID $BACKEND_PID $UI_PID"
echo ""
```

### Step 7: Cleanup Script

**Create shutdown script:**

```bash
# Save PIDs to file for later cleanup
echo $REGISTRATION_PID > /tmp/platform-pids.txt
echo $BACKEND_PID >> /tmp/platform-pids.txt
echo $UI_PID >> /tmp/platform-pids.txt

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down services..."

  if [ -f /tmp/platform-pids.txt ]; then
    while read PID; do
      kill $PID 2>/dev/null && echo "  Stopped process $PID"
    done < /tmp/platform-pids.txt
    rm /tmp/platform-pids.txt
  fi

  echo "Cleanup complete"
}

# Register cleanup on script exit
trap cleanup EXIT INT TERM
```

## Advanced: Docker Compose Alternative

**Create `docker-compose.dev.yml` (optional):**

```yaml
version: '3.8'

services:
  platform-registration:
    build:
      context: ../platform-registration-service
      dockerfile: Dockerfile
    ports:
      - "38101:38101"
    environment:
      - QUARKUS_HTTP_PORT=38101
    healthcheck:
      test: ["CMD", "grpcurl", "-plaintext", "localhost:38101", "grpc.health.v1.Health/Check"]
      interval: 10s
      timeout: 5s
      retries: 5

  platform-shell:
    depends_on:
      platform-registration:
        condition: service_healthy
    build:
      context: .
      dockerfile: apps/platform-shell/Dockerfile
    ports:
      - "38106:38106"
      - "33000:33000"
    environment:
      - PORT=38106
      - VITE_DEV_SERVER_PORT=33000
      - PLATFORM_REGISTRATION_HOST=platform-registration
      - PLATFORM_REGISTRATION_PORT=38101
    volumes:
      - ./apps/platform-shell/ui:/app/apps/platform-shell/ui
      - ./packages:/app/packages
    command: pnpm run dev
```

## Agent Execution Instructions

**When executing this task, the agent should:**

1. Read this file completely
2. Verify prerequisites (Node, pnpm, Java, ports)
3. Execute steps 1-6 in order
4. Report any failures immediately with logs
5. If successful, print the status report
6. Keep processes running in background
7. Save PIDs for cleanup
8. Monitor logs for errors in first 30 seconds

**Error Handling:**
- If any step fails, stop and report
- Show relevant log output
- Suggest fixes (missing dependency, port conflict, etc.)
- Don't continue if critical services fail

**Success Indicators:**
- All health checks pass
- UI is accessible at http://localhost:33000
- gRPC calls work to platform-registration
- No errors in first 30 seconds of logs

## Deliverables

1. **Automated startup script** (`scripts/auto-start-all.sh`)
   - Implements all steps above
   - Saves PIDs for cleanup
   - Comprehensive error checking

2. **Shutdown script** (`scripts/stop-all.sh`)
   - Reads PIDs and kills processes
   - Cleans up temp files
   - Verifies processes stopped

3. **Status check script** (`scripts/check-status.sh`)
   - Checks if services are running
   - Shows health status
   - Displays process info and URLs

4. **Documentation** (`docs/AUTO_SETUP.md`)
   - How to use auto-start script
   - What each service does
   - Troubleshooting common issues
   - Manual startup alternative

## Success Criteria

- [ ] Agent can start all services from one command
- [ ] All services start successfully within 2 minutes
- [ ] Health checks pass for all services
- [ ] UI is accessible and functional
- [ ] Logs are captured for debugging
- [ ] Cleanup script stops everything cleanly
- [ ] Works on fresh clone without manual intervention

## Testing

**Test the automation:**
1. Kill all running services
2. Run auto-start script
3. Verify all services start
4. Open http://localhost:33000 in browser
5. Navigate to Health page
6. Verify services shown as healthy
7. Run stop script
8. Verify all processes terminated

## Notes for Agent

- Use `run_in_background: true` for long-running processes
- Capture output to log files for debugging
- Check health endpoints, not just process existence
- Give services time to start (don't rush the checks)
- Report clear status messages at each step
- If something fails, show the last 20 lines of logs
- Return the URLs the user needs at the end

## Example Agent Workflow

```
Agent: I'll start the complete build environment for you.

Agent: [Step 1/5] Verifying prerequisites...
✓ Node.js 22.21.1 detected
✓ pnpm 10.15.1 detected
✓ Java 21.0.1 detected
✓ All ports available

Agent: [Step 2/5] Starting platform-registration-service...
Agent: <uses Bash tool with run_in_background>
Agent: Waiting for health check...
✓ platform-registration-service is healthy

Agent: [Step 3/5] Building platform-frontend packages...
Agent: <runs pnpm install and build>
✓ All packages built successfully

Agent: [Step 4/5] Starting platform-shell backend...
Agent: <uses Bash tool with run_in_background>
✓ Backend is serving at http://localhost:38106

Agent: [Step 5/5] Starting platform-shell UI...
Agent: <uses Bash tool with run_in_background>
✓ Vite dev server ready at http://localhost:33000

Agent: ========================================
Agent: 🎉 Development environment is ready!
Agent: ========================================
Agent:
Agent: Open http://localhost:33000 in your browser
Agent:
Agent: Services:
Agent:   • platform-registration-service (gRPC): localhost:38101
Agent:   • platform-shell backend (API): http://localhost:38106
Agent:   • platform-shell UI (dev): http://localhost:33000
Agent:
Agent: Processes running in background (use BashOutput tool to check logs)
Agent:
Agent: To stop all services: ./scripts/stop-all.sh
```

## Error Scenarios

**Port already in use:**
```
ERROR: Port 38101 is already in use
Try: lsof -i :38101
Or: kill $(lsof -t -i :38101)
```

**Service won't start:**
```
ERROR: platform-registration-service failed health check
Logs: /tmp/platform-registration.log
Last 20 lines:
<show log output>
```

**Build failures:**
```
ERROR: pnpm build failed
Check: pnpm-lock.yaml may need updating
Try: pnpm install --force
```

## Additional Services (Optional)

**If other services need to be started:**

Add sections for:
- repository-service
- opensearch-manager
- mapping-service
- connector-service
- account-manager

Each with:
- Repository location
- Build command
- Start command
- Health check
- Port number

## Deliverables

1. `scripts/auto-start-all.sh` - One command to rule them all
2. `scripts/stop-all.sh` - Clean shutdown
3. `scripts/check-status.sh` - Health status checker
4. `docs/AUTO_SETUP.md` - Documentation
5. PIDs saved to `/tmp/platform-pids.txt` for cleanup

## Success Metrics

- Time to running environment: < 3 minutes
- Success rate: > 95% on fresh clone
- Developer happiness: Can start coding immediately
- Reduced support questions: No more "how do I run this?"
