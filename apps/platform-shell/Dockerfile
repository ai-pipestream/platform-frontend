# Multi-stage build for platform-shell (monorepo)
# This creates a single container with both the backend proxy and frontend UI
#
# Build from monorepo root: docker build -f apps/platform-shell/Dockerfile -t ai-pipestream/platform-shell .
# Run: docker run -p 38106:38106 ai-pipestream/platform-shell

# Stage 1: Build backend and frontend
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

# Set working directory to monorepo root
WORKDIR /app

# Copy monorepo workspace config
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

# Copy all package.json files for dependency resolution
COPY packages/connector-shared/package.json ./packages/connector-shared/
COPY packages/protobuf-forms/package.json ./packages/protobuf-forms/
COPY packages/shared-components/package.json ./packages/shared-components/
COPY packages/shared-nav/package.json ./packages/shared-nav/
COPY apps/platform-shell/package.json ./apps/platform-shell/
COPY apps/platform-shell/ui/package.json ./apps/platform-shell/ui/

# Install all dependencies (includes UI as workspace member)
RUN pnpm install --frozen-lockfile

# Copy source code for packages
COPY packages/ ./packages/

# Copy source code for platform-shell
COPY apps/platform-shell/src ./apps/platform-shell/src
COPY apps/platform-shell/ui ./apps/platform-shell/ui
COPY apps/platform-shell/tsconfig.json ./apps/platform-shell/

# Build all packages (UI depends on shared-components and shared-nav)
RUN pnpm --filter @ai-pipestream/connector-shared build
RUN pnpm --filter @ai-pipestream/protobuf-forms build
RUN pnpm --filter @ai-pipestream/shared-components build
RUN pnpm --filter @ai-pipestream/shared-nav build

# Build platform-shell backend (TypeScript → JavaScript in dist/)
RUN cd apps/platform-shell && pnpm run build

# Build platform-shell frontend UI (Vite → static assets)
RUN cd apps/platform-shell/ui && pnpm run build

# Stage 2: Production runtime (minimal image)
FROM node:22-alpine AS runtime

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@10.15.1 --activate

# Create app user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy monorepo workspace config
COPY --chown=nodejs:nodejs pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./

# Copy package.json files for workspace
COPY --chown=nodejs:nodejs packages/connector-shared/package.json ./packages/connector-shared/
COPY --chown=nodejs:nodejs packages/protobuf-forms/package.json ./packages/protobuf-forms/
COPY --chown=nodejs:nodejs apps/platform-shell/package.json ./apps/platform-shell/

# Install only production dependencies
RUN pnpm install --frozen-lockfile --prod && \
    pnpm store prune && \
    rm -rf /root/.local/share/pnpm/store

# Copy built packages
COPY --from=builder --chown=nodejs:nodejs /app/packages/connector-shared/dist ./packages/connector-shared/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/protobuf-forms/dist ./packages/protobuf-forms/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared-components/dist ./packages/shared-components/dist
COPY --from=builder --chown=nodejs:nodejs /app/packages/shared-nav/dist ./packages/shared-nav/dist

# Copy built backend
COPY --from=builder --chown=nodejs:nodejs /app/apps/platform-shell/dist ./apps/platform-shell/dist

# Copy built frontend (static assets)
# Vite builds to apps/platform-shell/public
COPY --from=builder --chown=nodejs:nodejs /app/apps/platform-shell/public ./apps/platform-shell/public

# Switch to non-root user
USER nodejs

# Set working directory to app
WORKDIR /app/apps/platform-shell

# Environment variables with sensible defaults
ENV NODE_ENV=production
ENV PORT=38106
ENV VITE_PORT=33000
ENV PLATFORM_REGISTRATION_HOST=platform-registration-service
ENV PLATFORM_REGISTRATION_PORT=38101

# Expose backend port (frontend is served as static files from backend)
EXPOSE 38106

# Health check - check if backend is responding
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:${PORT}/', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# Run the application
CMD ["node", "dist/index.js"]
