import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {main:'index.html', preview:'preview.html', ylavint:'ylavint.html'},
      output: {
        manualChunks(id) {
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor'
        },
      },
    },
  },
})
