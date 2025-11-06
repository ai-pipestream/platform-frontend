import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['@io-pipeline/grpc-stubs'],
    esbuildOptions: {
      target: 'es2020',
    },
  },
  build: {
    target: 'es2020',
    outDir: '../public',
    emptyOutDir: true,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  server: {
    port: 33000,
    proxy: {
      // Proxy Connect protocol service requests (io.pipeline.*)
      '^/io\\.pipeline\\.': {
        target: 'http://localhost:38106',
        changeOrigin: true,
      },
      // Proxy REST API endpoints
      '/connect': {
        target: 'http://localhost:38106',
        changeOrigin: true,
      },
      '/proxy': {
        target: 'http://localhost:38106',
        changeOrigin: true,
      },
    },
  },
});
