/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['maplibre-gl'] }, // pre-bundling breaks maplibre's web worker URL
  server: { proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: { chunkSizeWarningLimit: 1200 }, // maplibre-gl alone is ~1 MB
  test: { exclude: ['e2e/**', 'node_modules/**'], environment: 'jsdom', setupFiles: './src/test/setup.ts', globals: false },
})
