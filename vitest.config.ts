import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'

const configuredCiWorkers = Number.parseInt(process.env.HRONAUT_VITEST_WORKERS ?? '4', 10)
const ciMaxWorkers = Number.isInteger(configuredCiWorkers) && configuredCiWorkers > 0
  ? configuredCiWorkers
  : 4

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/renderer/**'],
          maxWorkers: process.env.CI ? ciMaxWorkers : undefined
        }
      },
      {
        plugins: [vue(), Icons({ compiler: 'vue3' })],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/renderer/**/*.test.ts'],
          setupFiles: ['./tests/renderer/setup.ts'],
          maxWorkers: process.env.CI ? ciMaxWorkers : undefined
        }
      }
    ]
  }
})
