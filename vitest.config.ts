import { defineConfig, type Plugin } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import Icons from 'unplugin-icons/vite'

const configuredCiWorkers = Number.parseInt(process.env.HRONAUT_VITEST_WORKERS ?? '4', 10)
const ciMaxWorkers = Number.isInteger(configuredCiWorkers) && configuredCiWorkers > 0
  ? configuredCiWorkers
  : 4
const rendererMaxWorkers = Math.min(ciMaxWorkers, 2)

/**
 * Starts a worker thread of main as electron-vite's `?nodeWorker` import does in the app, from its TypeScript file,
 * which Node runs as it is: such a worker imports only Node's built-in modules.
 */
function nodeWorkers(): Plugin {
  const prefix = '\0node-worker:'
  return {
    name: 'hronaut-node-workers',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('?nodeWorker')) return null
      const resolved = await this.resolve(source.slice(0, -'?nodeWorker'.length), importer, { skipSelf: true })
      return resolved ? `${prefix}${resolved.id}` : null
    },
    load(id) {
      if (!id.startsWith(prefix)) return null
      const file = JSON.stringify(id.slice(prefix.length))
      return `import { Worker } from 'node:worker_threads'\nexport default (options) => new Worker(${file}, options)\n`
    }
  }
}

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [nodeWorkers()],
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
