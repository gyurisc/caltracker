import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dashboard only. The API + bot live in src/ and run on PORT (see .env).
// Read it here too, or the dev proxy points at a port nothing listens on.
// Resolved against this file, not cwd — dotenv reads cwd by default.
config({ path: fileURLToPath(new URL('.env', import.meta.url)) })
const API_PORT = process.env.PORT || '3000'

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${API_PORT}` },
  },
  build: { outDir: '../dist', emptyOutDir: true },
})
