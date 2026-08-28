import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  base: './',
  build: { target: 'es2022', outDir: 'dist', chunkSizeWarningLimit: 2000 },
  server: { port: 5173, strictPort: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any)
