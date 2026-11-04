import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      // Kecualikan /api/src/: itu modul frontend yang di-share dari folder api
      // (mis. utils/kodeRekening.js), harus disajikan Vite, bukan ke backend.
      '^/api/(?!src/)': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
