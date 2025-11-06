# Platform Frontend

[![Build Status](https://github.com/io-pipeline/platform-frontend/workflows/Build%20and%20Publish%20Platform%20Frontend/badge.svg)](https://github.com/io-pipeline/platform-frontend/actions)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Frontend monorepo for the IO Pipeline platform, containing the unified Platform Shell application and reusable UI component libraries.

## Overview

This monorepo provides:

- **Platform Shell**: Unified web frontend with dynamic service discovery and Connect-ES proxy
- **Shared Component Libraries**: Reusable Vue 3 + Vuetify 3 components published to npm
- **Type-Safe Forms**: Auto-generated forms from Protocol Buffer definitions
- **Connector Utilities**: Streaming protocols and document processing tools

## Architecture

```
platform-frontend/
├── apps/
│   └── platform-shell/          # Main platform application
│       ├── src/                 # Backend (Express + Connect-ES proxy)
│       └── ui/                  # Frontend (Vue 3 + Vuetify)
└── packages/
    ├── shared-components/       # UI component library + ComponentGallery
    ├── shared-nav/              # Navigation shell components
    ├── connector-shared/        # Backend connector utilities
    └── protobuf-forms/          # Type-safe form generation
```

## Published Packages

All packages are published to npm under the `@io-pipeline` scope:

| Package | Version | Description |
|---------|---------|-------------|
| [@io-pipeline/shared-components](https://www.npmjs.com/package/@io-pipeline/shared-components) | 1.0.7 | Vue 3 + Vuetify 3 UI components with ComponentGallery |
| [@io-pipeline/shared-nav](https://www.npmjs.com/package/@io-pipeline/shared-nav) | 1.0.0 | Navigation shell (AppShell, Drawer, AppBar) |
| [@io-pipeline/connector-shared](https://www.npmjs.com/package/@io-pipeline/connector-shared) | 1.0.0 | Backend utilities for connectors and streaming |
| [@io-pipeline/protobuf-forms](https://www.npmjs.com/package/@io-pipeline/protobuf-forms) | 1.0.0 | Type-safe form generation from protobuf messages |

## Prerequisites

- **Node.js**: 22.x
- **pnpm**: 10.x

```bash
# Enable corepack and install pnpm
corepack enable
corepack prepare pnpm@latest --activate
```

## Quick Start

### Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run Platform Shell in development mode
./scripts/start-platform-shell.sh
```

Access the platform at:
- **Frontend (with hot-reload)**: http://localhost:33000
- **Backend API**: http://localhost:38106

### Production

```bash
# Build everything
pnpm build

# Run in production mode
cd apps/platform-shell
NODE_ENV=production pnpm start
```

Access at: http://localhost:38106

## Docker

### Quick Run

```bash
# Build the image
docker build -f apps/platform-shell/Dockerfile -t platform-shell .

# Run the container
docker run -d \
  --name platform-shell \
  -p 38106:38106 \
  -e PLATFORM_REGISTRATION_HOST=platform-registration-service \
  -e PLATFORM_REGISTRATION_PORT=38101 \
  platform-shell
```

Access at: http://localhost:38106

### Pre-built Images

Images are automatically published to Gitea Container Registry on every push to `main`:

```bash
docker pull git.rokkon.com/io-pipeline/platform-shell:latest
```

## Development Scripts

Convenient scripts for local development:

```bash
# Start backend only (port 38106)
./scripts/start-backend.sh

# Start frontend only (port 33000)
./scripts/start-frontend.sh

# Start both together with hot-reload
./scripts/start-platform-shell.sh
```

## Platform Shell Features

### Service Discovery

Platform Shell dynamically discovers and routes to available services via the platform-registration-service:

- **Account Manager**: User account management
- **Connector Service**: Configure and manage data connectors
- **Mapping Service**: Field mapping and transformations
- **OpenSearch Manager**: Search cluster management
- **Repository Service**: Document repository operations

### Pipeline Modules

Modular processing components:

- **Chunker**: Text chunking for embeddings
- **Echo**: Test/debug module
- **Embedder**: Vector embedding generation
- **Parser**: Document parsing and extraction

### Graceful Degradation

The platform gracefully handles service unavailability:

- Beautiful error page with system diagnostics
- Real-time service health monitoring
- Retry capability with auto-reload
- Works offline for development

## Package Development

### Building Packages

```bash
# Build all packages
pnpm -r build

# Build specific package
pnpm --filter @io-pipeline/shared-components build

# Watch mode for development
pnpm --filter @io-pipeline/shared-components dev
```

### Publishing

Packages are automatically published via CI/CD, but you can manually publish:

```bash
cd packages/shared-components
pnpm publish
```

## Environment Variables

### Platform Shell

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `38106` | Server port |
| `NODE_ENV` | `development` | Environment mode |
| `PLATFORM_REGISTRATION_HOST` | `localhost` | Registration service host |
| `PLATFORM_REGISTRATION_PORT` | `38101` | Registration service port |

## API Endpoints

### Connect-ES RPC

All backend services are proxied through Connect-ES:

```
POST /io.pipeline.platform.registration.PlatformRegistration/ListServices
POST /io.pipeline.repository.account.AccountService/ListAccounts
POST /io.pipeline.connector.ConnectorService/ListConnectors
POST /io.pipeline.mapping.MappingService/GetMapping
# etc - follows /io.pipeline.{package}.{Service}/{Method} pattern
```

### System Status

```bash
# Check system health
curl http://localhost:38106/api/system-status

# Response (200 if healthy, 503 if services unavailable)
{
  "proxy": {
    "status": "healthy",
    "message": "Platform shell proxy is running"
  },
  "registration": {
    "status": "healthy",
    "message": "Platform registration service is reachable",
    "url": "http://localhost:38101"
  },
  "timestamp": "2025-11-06T19:15:32.123Z"
}
```

## Project Structure

### Apps

- **platform-shell**: Main unified frontend application
  - Backend: Express server with Connect-ES proxy
  - Frontend: Vue 3 + Vuetify SPA
  - Routing: Dynamic service/module discovery

### Packages

#### shared-components

Reusable UI components including:
- ComponentGallery: Interactive component showcase
- Form components: Vuetify-based form controls
- Layout components: Cards, dialogs, etc.

```typescript
import { ComponentGallery } from '@io-pipeline/shared-components';
import '@io-pipeline/shared-components/dist/style.css';
```

#### shared-nav

Navigation shell components:
- NavShell: Main application shell
- AppBar: Top navigation bar
- Drawer: Side navigation drawer

```typescript
import { NavShell } from '@io-pipeline/shared-nav';
```

#### connector-shared

Backend utilities for connector functionality:
- Streaming protocols
- Upload clients
- Document processing utilities

```typescript
import { createUploadClient } from '@io-pipeline/connector-shared';
```

#### protobuf-forms

Type-safe form generation from Protocol Buffer messages:

```typescript
import { createFormSchema } from '@io-pipeline/protobuf-forms';
import { MyMessage } from './generated/my_pb';

const schema = createFormSchema(MyMessage);
```

## CI/CD

### GitHub Actions

Automated workflows for building, testing, and publishing:

1. **Build and Test**: Runs on every push and PR
   - Install dependencies
   - Build all packages
   - Verify build artifacts

2. **Docker Build and Push**: Runs on `main` branch only
   - Build Docker image
   - Test container (frontend serves, API responds)
   - Push to container registry

### Workflow Files

- `.github/workflows/build-and-publish.yml`: GitHub Actions workflow
- `.gitea/workflows/build-and-publish.yml`: Gitea Actions workflow (mirror)

## Dependencies

### Core Dependencies

- **Vue 3**: Frontend framework
- **Vuetify 3**: Material Design component library
- **Connect-ES**: gRPC-web client/server
- **Express**: Backend web server
- **Pinia**: State management
- **Vue Router**: Client-side routing

### Build Tools

- **Vite**: Frontend build tool and dev server
- **TypeScript**: Type-safe development
- **tsx**: TypeScript execution
- **tsup**: Library bundler

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Build and test locally: `pnpm build && pnpm test`
4. Commit with descriptive messages
5. Push and create a pull request

## Troubleshooting

### Port Already in Use

The development scripts will warn you if ports are in use:

```bash
# Kill processes on ports
./scripts/start-backend.sh  # Offers to kill process on port 38106
./scripts/start-frontend.sh # Offers to kill process on port 33000
```

### Build Failures

```bash
# Clean and rebuild everything
pnpm clean
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm build
```

### Docker Issues

```bash
# View container logs
docker logs platform-shell

# Shell into container
docker exec -it platform-shell /bin/sh

# Clean restart
docker rm -f platform-shell
docker build -f apps/platform-shell/Dockerfile -t platform-shell .
docker run -d --name platform-shell -p 38106:38106 platform-shell
```

## License

MIT License - see [LICENSE](LICENSE) file for details

## Links

- **GitHub Repository**: https://github.com/io-pipeline/platform-frontend
- **npm Organization**: https://www.npmjs.com/org/io-pipeline
- **Issue Tracker**: https://github.com/io-pipeline/platform-frontend/issues
- **Documentation**: [Platform Shell README](apps/platform-shell/README.md)

## Support

For questions or issues:
1. Check existing [GitHub Issues](https://github.com/io-pipeline/platform-frontend/issues)
2. Create a new issue with details about your environment and problem
3. Tag issues appropriately (bug, enhancement, question, etc.)
