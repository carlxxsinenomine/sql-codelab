import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/sql-codelab/', // 👈 replace with your repo name
  build: {
    chunkSizeWarningLimit: 750, // Increase from default 500 kB
  },
})