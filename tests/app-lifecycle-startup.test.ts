import { describe, expect, it, vi } from 'vitest'
import { registerAppLifecycle } from '../src/main/app-lifecycle.js'

/** An app that is ready at once, and the lifecycle registered on it with `startRuntime` and the quit state given. */
function lifecycle(startRuntime: () => Promise<void>, quitting = false) {
  let ready!: () => void
  const whenReady = new Promise<void>((resolve) => { ready = resolve })
  const app = { on: vi.fn(), whenReady: () => whenReady, quit: vi.fn(), exit: vi.fn() }
  const startupFailed = vi.fn(async () => undefined)
  const quit = { quitting }
  registerAppLifecycle(app as never, {
    gotLock: true,
    quitRequestedAtStartup: false,
    quit,
    settings: () => ({}) as never,
    showWindow: vi.fn(),
    commercialLicenseStateTimer: () => undefined,
    mainWindowRefs: { lastState: null },
    currentWindowState: () => null,
    panelWindowRefs: { lastState: null },
    currentPanelWindowState: () => null,
    startRuntime,
    startupFailed,
    tabs: () => null,
    mcpRuntime: { server: null },
    releaseRuntimeResources: async () => undefined
  })
  return { app, quit, startupFailed, ready }
}

describe('starting once Electron is ready', () => {
  it('says Hronaut could not start when startup fails, instead of staying without a window', async () => {
    const failure = new Error('settings.json could not be read')
    const { startupFailed, ready } = lifecycle(async () => { throw failure })
    ready()
    await vi.waitFor(() => expect(startupFailed).toHaveBeenCalledExactlyOnceWith(failure))
  })

  it('only logs a start that quitting interrupted', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failure = new Error('window closed while starting')
    const { startupFailed, ready } = lifecycle(async () => { throw failure }, true)
    ready()
    await vi.waitFor(() => expect(logged).toHaveBeenCalledWith('[startup] Startup ended while quitting:', failure))
    expect(startupFailed).not.toHaveBeenCalled()
    logged.mockRestore()
  })

  it('says nothing after a start that succeeded', async () => {
    const startRuntime = vi.fn(async () => undefined)
    const { startupFailed, ready } = lifecycle(startRuntime)
    ready()
    await vi.waitFor(() => expect(startRuntime).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(startupFailed).not.toHaveBeenCalled()
  })
})

describe('a helper process that ends', () => {
  type GoneListener = (event: unknown, details: Partial<Electron.Details>) => void
  const gone = (app: { on: ReturnType<typeof vi.fn> }): GoneListener =>
    app.on.mock.calls.find(([event]) => event === 'child-process-gone')![1] as GoneListener

  it('logs a GPU or network service process that crashed, which left no trace before', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { app } = lifecycle(async () => undefined)
    gone(app)({}, { type: 'GPU', reason: 'crashed', exitCode: 139 })
    gone(app)({}, { type: 'Utility', name: 'Network Service', reason: 'killed', exitCode: 9 })
    expect(logged.mock.calls).toEqual([
      ['[process] GPU process ended: crashed (exit code 139)'],
      ['[process] Utility (Network Service) process ended: killed (exit code 9)']
    ])
    logged.mockRestore()
  })

  it('says nothing for a process that exited cleanly or while Hronaut quits', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    gone(lifecycle(async () => undefined).app)({}, { type: 'Utility', name: 'Audio Service', reason: 'clean-exit', exitCode: 0 })
    gone(lifecycle(async () => undefined, true).app)({}, { type: 'GPU', reason: 'killed', exitCode: 15 })
    expect(logged).not.toHaveBeenCalled()
    logged.mockRestore()
  })
})
