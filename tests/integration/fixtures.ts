import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@playwright/test'
import { removeTestDirectory } from '../helpers/remove-test-directory.js'
import { integrationMcpPort } from './port-allocation.js'
import { ElectronTraceRecorder } from './electron-tracing.js'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const testTraces = new WeakMap<TestInfo, ElectronTraceRecorder>()
const applicationTraces = new WeakMap<ElectronApplication, ElectronTraceRecorder>()

export interface HronautInstance {
  app: ElectronApplication
  window: Page
}

interface FixtureServer {
  close(callback: (error?: Error) => void): unknown
  closeAllConnections?: () => void
}

export async function closeFixtureServer(server: FixtureServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error)
        return
      }
      resolve()
    })
    // Chromium can keep an otherwise idle page connection alive after every
    // assertion has completed. Stop accepting first, then close those test-only
    // sockets so teardown cannot consume the test's global timeout.
    server.closeAllConnections?.()
  })
}

export async function blockFileDestination(path: string): Promise<() => Promise<void>> {
  const backupPath = `${path}.${randomUUID()}.test-backup`
  await rename(path, backupPath)
  await mkdir(path)
  let restored = false
  return async () => {
    if (restored) return
    restored = true
    await rm(path, { recursive: true, force: true })
    await rename(backupPath, path)
  }
}

export interface HronautFixtures {
  electronTraces: ElectronTraceRecorder
  appWindow: Page
  electronApp: ElectronApplication
  mcpToken: string
  mcpPort: number
  profileDirectory: string
}

export async function launchHronaut(
  profileDirectory: string,
  mcpPort?: number,
  interfaceScale = 1,
  appArguments: string[] = []
): Promise<HronautInstance> {
  const settingsPath = join(profileDirectory, 'settings.json')
  try {
    await readFile(settingsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Existing geometry cases explicitly exercise top tabs and the complete catalog.
    // Fresh-profile coverage separately verifies the production left-rail default.
    await writeFile(settingsPath, `${JSON.stringify({ interfaceScale, tabPosition: 'top', mcpToolSet: 'complete' }, null, 2)}\n`, 'utf8')
  }
  const environment = { ...process.env }
  if (mcpPort === undefined) delete environment.HRONAUT_MCP_PORT
  else environment.HRONAUT_MCP_PORT = String(mcpPort)
  const app = await electron.launch({
    executablePath: process.env.HRONAUT_TEST_EXECUTABLE,
    args: [
      ...(process.env.HRONAUT_TEST_EXECUTABLE ? [] : ['.']),
      ...appArguments,
      ...(process.env.HRONAUT_TEST_WAYLAND === '1' ? ['--ozone-platform=wayland'] : [])
    ],
    cwd: repositoryRoot,
    env: {
      ...environment,
      HRONAUT_MCP_HOST: '127.0.0.1',
      HRONAUT_USER_DATA_DIR: profileDirectory,
      HRONAUT_DOWNLOAD_DIR: profileDirectory
    }
  })
  await app.evaluate(({ app }) => {
    const exits: { reason: string; exitCode: number; webContentsId: number; type: string; surface: string; occurredAt: number }[] = []
    const listener: (event: Electron.Event, contents: Electron.WebContents, details: Electron.RenderProcessGoneDetails) => void = (_event, contents, details) => {
      let type = 'destroyed'
      let surface = 'unknown'
      try {
        type = contents.getType()
        const url = contents.getURL()
        surface = url.startsWith('hronaut://home') ? 'home' : url.startsWith('file:') ? 'app' : 'page'
      } catch { /* Renderer may already be destroyed. */ }
      // Classify the surface without attaching page URLs or profile paths.
      exits.push({ reason: details.reason, exitCode: details.exitCode, webContentsId: contents.id, type, surface, occurredAt: Date.now() })
      if (exits.length > 16) exits.shift()
    }
    app.on('render-process-gone', listener)
    ;(globalThis as typeof globalThis & {
      __hronautQaRendererExits?: { exits: typeof exits; listener: typeof listener }
    }).__hronautQaRendererExits = { exits, listener }
  })
  const window = await app.firstWindow()
  window.on('pageerror', (error) => console.error(`[renderer] ${error.message}`))
  window.on('console', (message) => {
    if (message.type() === 'error') console.error(`[renderer] ${message.text()}`)
  })
  await window.waitForLoadState('domcontentloaded')
  // Electron exposes its context before the first Page is fully initialized.
  // Starting earlier can miss installing Playwright's DOM snapshot streamer
  // in that page for its entire lifetime, despite recording screenshots.
  const traces = testTraces.get(base.info())
  if (traces) {
    applicationTraces.set(app, traces)
    await traces.start(app)
  }
  return { app, window }
}

export async function closeHronaut(app: ElectronApplication): Promise<void> {
  await applicationTraces.get(app)?.stop(app)
  applicationTraces.delete(app)
  let child: ReturnType<ElectronApplication['process']>
  try {
    child = app.process()
  } catch {
    return
  }
  await settleWithin(app.evaluate(({ app }) => {
    const scope = globalThis as typeof globalThis & {
      __hronautQaRendererExits?: { listener: (event: Electron.Event, contents: Electron.WebContents, details: Electron.RenderProcessGoneDetails) => void }
    }
    if (scope.__hronautQaRendererExits) app.off('render-process-gone', scope.__hronautQaRendererExits.listener)
    delete scope.__hronautQaRendererExits
  }).catch(() => undefined), 1_000)
  const closePromise = app.close().catch(() => undefined)
  await settleWithin(closePromise, 3_000)
  if (child.exitCode === null) {
    child.kill('SIGTERM')
    await waitForExit(child, 2_000)
  }
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await waitForExit(child, 2_000)
  }
  await settleWithin(closePromise, 1_000)
}

async function settleWithin(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  await Promise.race([
    promise,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs)
    })
  ])
  if (timer) clearTimeout(timer)
}

async function waitForExit(
  child: ReturnType<ElectronApplication['process']>,
  timeoutMs: number
): Promise<void> {
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      clearTimeout(timer)
      child.off('exit', finish)
      resolve()
    }
    const timer = setTimeout(finish, timeoutMs)
    child.once('exit', finish)
  })
}

export const test = base.extend<HronautFixtures>({
  electronTraces: [async ({ trace }, use, testInfo) => {
    const traces = new ElectronTraceRecorder(testInfo, trace)
    testTraces.set(testInfo, traces)
    try { await use(traces) } finally {
      testTraces.delete(testInfo)
      await traces.finish()
    }
  }, { auto: true }],

  profileDirectory: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-integration-'))
    await use(directory)
    await removeTestDirectory(directory)
  },

  mcpPort: async ({}, use, testInfo) => {
    await use(integrationMcpPort(process.env.HRONAUT_TEST_SHARD_INDEX, testInfo.workerIndex))
  },

  electronApp: async ({ profileDirectory, mcpPort }, use, testInfo) => {
    const instance = await launchHronaut(profileDirectory, mcpPort)
    try {
      await use(instance.app)
    } finally {
      try {
        if (testInfo.status !== testInfo.expectedStatus) {
          const diagnostics = await instance.app.evaluate(() => {
            const scope = globalThis as typeof globalThis & {
              __hronautQaRendererExits?: { exits: { reason: string; exitCode: number; webContentsId: number; type: string }[] }
            }
            return { rendererExits: scope.__hronautQaRendererExits?.exits ?? [] }
          }).catch(() => ({ unavailable: 'Main process closed before diagnostics could be collected' }))
          await testInfo.attach('renderer-exits', { body: JSON.stringify(diagnostics), contentType: 'application/json' })
        }
      } finally {
        await closeHronaut(instance.app)
      }
    }
  },

  mcpToken: async ({ electronApp: _electronApp, profileDirectory }, use) => {
    const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
    await use(token)
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await use(window)
  }
})

export { expect } from '@playwright/test'
