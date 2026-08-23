import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/renderer/**']
        }
      },
      {
        plugins: [vue(), Icons({ compiler: 'vue3' })],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.ts'],
          setupFiles: ['./tests/renderer/setup.ts']
        }
      }
    ]
  }
})
