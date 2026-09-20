import { defineConfig } from 'vite'

export default defineConfig({
  root: 'website',
  base: '/hronaut/',
  build: {
    outDir: '../docs',
    emptyOutDir: false,
    sourcemap: true
  }
})
