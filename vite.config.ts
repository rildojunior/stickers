import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // O jSquash carrega o .wasm por import.meta.url; não pode ser pré-empacotado.
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  worker: { format: 'es' },
  server: { host: true },
})
