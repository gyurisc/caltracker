import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dashboard only. The API + bot live in src/ and run on :3000.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { outDir: '../dist', emptyOutDir: true },
})
