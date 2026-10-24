import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react({
      // React Compiler is opt-in — disabled here, app works fine without it
      babel: { plugins: [] },
    }),
  ],
  base: '/operators-pm-board/',
})
