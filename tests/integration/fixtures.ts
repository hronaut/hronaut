import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import {
  _electron as electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@playwright/test'
import { removeTestDirectory } from '../helpers/remove-test-directory.js'
import { integrationMcpPort } from './port-allocation.js'
import { ElectronTraceRecorder } from './electron-tracing.js'
import { startWorkerDisplay } from './worker-display.js'
import { activityDiagnostics, attachActivityDiagnostics } from './activity-failure-diagnostics.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function expectFixtureSuccess(result: CallToolResult, operation: string): void {
  const status = ['BUSY', 'LEASE_LOST', 'OUTCOME_UNKNOWN', 'STALE_OBSERVATION', 'POLICY_REJECTED',
    'TIMED_OUT', 'STALE_PRECONDITION', 'UNTRUSTED_TARGET'].find(value => value === result.structuredContent?.status)
  // Report only a fixed outcome category, never raw MCP text or resume keys.
  expect({ isError: result.isError === true, status: status ?? 'unspecified' }, operation)
    .toMatchObject({ isError: false })
}

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
  /**
   * Starts the `electronApp` fixture's Hronaut with an empty stand-in home folder, so agents installed on this
   * computer, such as Claude Code, do not change what Home lists. Off by default: the home folder also holds display
   * and font settings. A case that launches Hronaut again passes `standInHomeEnvironment` to `launchHronaut` itself.
   */
  standInHome: boolean
}

/** An empty home folder inside the test profile, with no agent's settings in it, as `launchHronaut` overrides. */
export async function standInHomeEnvironment(profileDirectory: string): Promise<Record<string, string | undefined>> {
  const home = join(profileDirectory, 'stand-in-home')
  await mkdir(home, { recursive: true })
  // An X11 desktop that does not export XAUTHORITY keeps the display's key in the real home folder.
  const authority = process.env.XAUTHORITY ?? (process.env.HOME ? join(process.env.HOME, '.Xauthority') : undefined)
  const keepAuthority = authority !== undefined && await access(authority).then(() => true, () => false)
  return { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: undefined, ...(keepAuthority ? { XAUTHORITY: authority } : {}) }
}

export async function launchHronaut(
  profileDirectory: string,
  mcpPort?: number,
  interfaceScale = 1,
  appArguments: string[] = [],
  electronArguments: string[] = [],
  /**
   * Variables to change for this launch only; undefined removes one. The MCP port and host, the profile and the
   * download folder always come from the arguments above.
   */
  environmentOverrides: Record<string, string | undefined> = {}
): Promise<HronautInstance> {
  const settingsPath = join(profileDirectory, 'settings.json')
  try {
    await readFile(settingsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    // Existing geometry cases explicitly exercise top tabs and the complete catalog, existing color cases the System
    // theme, and existing MCP cases a listener without authentication. Fresh-profile coverage separately verifies the
    // production left-rail, Cyberpunk and authentication defaults.
    await writeFile(settingsPath, `${JSON.stringify({ theme: 'system', interfaceScale, tabPosition: 'top', mcpToolSet: 'complete', mcpAuthentication: false }, null, 2)}\n`, 'utf8')
  }
  const environment = { ...process.env }
  for (const [name, value] of Object.entries(environmentOverrides)) {
    if (value === undefined) delete environment[name]
    else environment[name] = value
  }
  if (mcpPort === undefined) delete environment.HRONAUT_MCP_PORT
  else environment.HRONAUT_MCP_PORT = String(mcpPort)
  const app = await electron.launch({
    executablePath: process.env.HRONAUT_TEST_EXECUTABLE,
    args: [
      ...electronArguments,
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
  try {
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
  } catch (error) {
    // Ownership has not reached the caller yet, so its teardown cannot close
    // an application whose first window or renderer initialization failed.
    await closeHronaut(app).catch(() => undefined)
    throw error
  }
}

/** Waits for shell entrances and exits to finish, so checks see final opacity and size. */
export async function settleShellMotion(window: Page): Promise<void> {
  await window.evaluate(() => Promise.all(document.getAnimations()
    // Spinners and other endless animations never finish.
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined))))
}

/**
 * Tab mutations fail closed until saved workspaces finish loading, and startup reads wait for that,
 * so one read keeps a test from racing initialization on slow runners. A failed read means startup
 * itself failed, which the tests that cover it assert on their own. Startups that wait on a person
 * (recovery prompts) are bounded so those tests still get the window.
 */
export async function waitForSavedWorkspaces(window: Page): Promise<void> {
  await window.evaluate(`Promise.race([
    Promise.resolve(window.hronautHistory?.list()).catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, 10000))
  ]).then(() => undefined)`)
}

/**
 * What the main process knows of each renderer when a test fails: its exits, and whether each page still answers a
 * script, which tells a busy shell or page from a busy main process, as that answers nothing at all.
 */
export async function collectRendererDiagnostics(app: ElectronApplication): Promise<unknown> {
  const pending = app.evaluate(async ({ webContents }) => {
    const scope = globalThis as typeof globalThis & {
      __hronautQaRendererExits?: { exits: { reason: string; exitCode: number; webContentsId: number; type: string }[] }
    }
    const within = <T>(promise: Promise<T>, fallback: T): Promise<T> => Promise.race([promise, new Promise<T>(resolve => setTimeout(() => resolve(fallback), 400))])
    const nativeContents = await Promise.all(webContents.getAllWebContents().slice(0, 32).map(async contents => {
      try {
        const url = contents.getURL()
        const crashed = contents.isCrashed()
        return {
          id: contents.id,
          type: contents.getType(),
          surface: url.startsWith('hronaut://home') ? 'home' : url.startsWith('file:') ? 'app' : !url || url === 'about:blank' ? 'blank' : 'page',
          loading: contents.isLoadingMainFrame(),
          crashed,
          processId: contents.getOSProcessId(),
          answered: !crashed && await within(contents.executeJavaScript('0').then(() => true, () => false), false)
        }
      } catch {
        return { id: contents.id, unavailable: true }
      }
    }))
    return { rendererExits: scope.__hronautQaRendererExits?.exits ?? [], nativeContents }
  }).catch(() => ({ unavailable: 'Main process closed before diagnostics could be collected' }))
  let diagnostics: unknown = { unavailable: 'Main process did not respond to diagnostics within 2000ms' }
  await settleWithin(pending.then(result => { diagnostics = result }), 2_000)
  return diagnostics
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

export async function useHronautFixture(
  app: ElectronApplication,
  use: (app: ElectronApplication) => Promise<void>,
  info: Pick<import('@playwright/test').TestInfo, 'status' | 'expectedStatus' | 'attach'>
): Promise<void> {
  let bodyFailed = false
  let bodyError: unknown
  try { await use(app) } catch (error) { bodyFailed = true; bodyError = error }
  const recorder = activityDiagnostics(app)
  let cleanupFailed = false
  let cleanupError: unknown
  try {
    if (info.status !== info.expectedStatus) {
      const collect = () => collectRendererDiagnostics(app)
      const diagnostics = await (recorder ? recorder.main(collect, 'failure-probe') : collect())
      await info.attach('renderer-exits', { body: JSON.stringify(diagnostics), contentType: 'application/json' })
      // Kernel counters only: no environment, process arguments or browser data.
      const resources = Object.fromEntries(await Promise.all([
        '/sys/fs/cgroup/memory.events', '/sys/fs/cgroup/memory.current',
        '/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/cpu.stat',
        '/sys/fs/cgroup/cpu.pressure', '/sys/fs/cgroup/memory.pressure'
      ].map(async path => [path, await readFile(path, 'utf8').then(value => value.slice(0, 4096)).catch(() => 'unavailable')])))
      await info.attach('container-resources', { body: JSON.stringify(resources), contentType: 'application/json' })
    }
  } catch (error) { cleanupFailed = true; cleanupError = error } finally {
    await attachActivityDiagnostics(app, info)
    try { await closeHronaut(app) } catch (error) { cleanupFailed = true; cleanupError = error }
  }
  // Only the opt-in diagnostic path is best effort after an existing failure.
  if (cleanupFailed && !(recorder && (bodyFailed || info.status !== info.expectedStatus))) throw cleanupError
  if (bodyFailed) throw bodyError
}

export const test = base.extend<HronautFixtures, { workerDisplay: void }>({
  workerDisplay: [async ({}, use) => {
    if (process.env.HRONAUT_TEST_ISOLATED_DISPLAYS !== '1') {
      await use()
      return
    }
    const desktop = await startWorkerDisplay()
    const previousDisplay = process.env.DISPLAY
    const previousAuthority = process.env.XAUTHORITY
    process.env.DISPLAY = desktop.display
    delete process.env.XAUTHORITY
    try { await use() } finally {
      if (previousDisplay === undefined) delete process.env.DISPLAY
      else process.env.DISPLAY = previousDisplay
      if (previousAuthority === undefined) delete process.env.XAUTHORITY
      else process.env.XAUTHORITY = previousAuthority
      await desktop.close()
    }
  }, { scope: 'worker', auto: true }],

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
    await use(integrationMcpPort(process.env.HRONAUT_TEST_SHARD_INDEX, testInfo.workerIndex, process.env.HRONAUT_TEST_MCP_PORT_NAMESPACE))
  },

  standInHome: [false, { option: true }],

  electronApp: async ({ profileDirectory, mcpPort, standInHome }, use, testInfo) => {
    const environment = standInHome ? await standInHomeEnvironment(profileDirectory) : {}
    const instance = await launchHronaut(profileDirectory, mcpPort, undefined, undefined, undefined, environment)
    await useHronautFixture(instance.app, use, testInfo)
  },

  mcpToken: async ({ electronApp: _electronApp, profileDirectory }, use) => {
    const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
    await use(token)
  },

  appWindow: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await waitForSavedWorkspaces(window)
    await use(window)
  }
})

export { expect } from '@playwright/test'
