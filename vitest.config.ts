import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'

const configuredCiWorkers = Number.parseInt(process.env.HRONAUT_VITEST_WORKERS ?? '4', 10)
const ciMaxWorkers = Number.isInteger(configuredCiWorkers) && configuredCiWorkers > 0
  ? configuredCiWorkers
  : 4
const rendererMaxWorkers = Math.min(ciMaxWorkers, 2)

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          sequence: { groupOrder: 0 },
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
          sequence: { groupOrder: 1 },
          // A VM pool reuses each worker's expensive jsdom installation while
          // preserving a fresh module graph and window for every test file.
          // Keep the pool bounded because VM contexts retain more memory than
          // the default child-process pool until Vitest recycles a worker.
          pool: 'vmThreads',
          maxWorkers: rendererMaxWorkers,
          vmMemoryLimit: '384MB',
          include: ['tests/renderer/**/*.test.ts', 'src/renderer/src/features/**/*.test.ts'],
          setupFiles: ['./tests/renderer/setup.ts']
        }
      }
    ]
  }
})
