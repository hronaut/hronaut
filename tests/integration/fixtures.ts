import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  _electron as electron,
  test as base,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { removeTestDirectory } from '../helpers/remove-test-directory.js'
import { integrationMcpPort } from './port-allocation.js'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

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

interface HronautFixtures {
  appWindow: Page
  electronApp: ElectronApplication
  mcpToken: string
  mcpPort: number
  profileDirectory: string
}

export async function launchHronaut(
  profileDirectory: string,
  mcpPort?: number,
  interfaceScale = 1
): Promise<HronautInstance> {
  const settingsPath = join(profileDirectory, 'settings.json')
  try {
    await readFile(settingsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    await writeFile(settingsPath, `${JSON.stringify({ interfaceScale }, null, 2)}\n`, 'utf8')
  }
  const environment = { ...process.env }
  if (mcpPort === undefined) delete environment.HRONAUT_MCP_PORT
  else environment.HRONAUT_MCP_PORT = String(mcpPort)
  const app = await electron.launch({
    args: ['.'],
    cwd: repositoryRoot,
    env: {
      ...environment,
      HRONAUT_MCP_HOST: '127.0.0.1',
      HRONAUT_USER_DATA_DIR: profileDirectory,
      HRONAUT_DOWNLOAD_DIR: profileDirectory
    }
  })
  const window = await app.firstWindow()
  window.on('pageerror', (error) => console.error(`[renderer] ${error.message}`))
  window.on('console', (message) => {
    if (message.type() === 'error') console.error(`[renderer] ${message.text()}`)
  })
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

export async function closeHronaut(app: ElectronApplication): Promise<void> {
  let child: ReturnType<ElectronApplication['process']>
  try {
    child = app.process()
  } catch {
    return
  }
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
  profileDirectory: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-integration-'))
    await use(directory)
    await removeTestDirectory(directory)
  },

  mcpPort: async ({}, use, testInfo) => {
    await use(integrationMcpPort(process.env.HRONAUT_TEST_SHARD_INDEX, testInfo.workerIndex))
  },

  electronApp: async ({ profileDirectory, mcpPort }, use) => {
    const instance = await launchHronaut(profileDirectory, mcpPort)
    await use(instance.app)
    await closeHronaut(instance.app)
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
