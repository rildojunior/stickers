import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

// O transformers.js carrega o runtime ONNX (.wasm, ~26 MB) do jsDelivr. A cópia que o Vite
// empacota nunca é usada, então fica fora do deploy.
const dropOnnxWasm = (): Plugin => ({
  name: 'drop-onnx-wasm',
  apply: 'build',
  generateBundle(_, bundle) {
    for (const name of Object.keys(bundle)) {
      if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name]
    }
  },
})

export default defineConfig({
  plugins: [react()],
  // O jSquash carrega o .wasm por import.meta.url; não pode ser pré-empacotado.
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  worker: { format: 'es', plugins: () => [dropOnnxWasm()] },
  server: { host: true },
})
