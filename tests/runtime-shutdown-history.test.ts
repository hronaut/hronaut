import { expect, it, vi } from 'vitest'
import { createRuntimeShutdown } from '../src/main/runtime-shutdown.js'

// The browsing history saves its visits once a second. Quitting saved the visits of that last second only after the
// MCP listener, agents' receipts, Undo, workspace operations and wallets had stopped, which can last until the exit is
// forced, so they could be lost.

it('saves the visits of the last second as soon as shutdown starts, and those recorded meanwhile at the end', async () => {
  const calls: string[] = []
  let stopServer!: () => void
  const history = {
    flush: vi.fn(async () => { calls.push('history saved') }),
    dispose: vi.fn(() => { calls.push('history timers stopped') })
  }
  const siteIcons = {
    flush: vi.fn(async () => { calls.push('site icons saved') }),
    dispose: vi.fn(() => { calls.push('site icons timers stopped') })
  }
  const shutdown = createRuntimeShutdown({
    tabRuntime: { tabs: null },
    mcpRuntime: { server: { stop: () => new Promise<void>((resolve) => { stopServer = () => { calls.push('MCP stopped'); resolve() } }) } as never },
    walletRuntime: { service: null, broker: null } as never,
    bookmarksAndHistory: { bookmarks: null, history, siteIcons } as never,
    agentServices: { auditReceipts: null } as never,
    undoOffers: { close: async () => undefined },
    credentialRuntime: { store: null } as never,
    browserSessionState: { sitePermissionStore: null } as never,
    commercialLicenseRuntime: { store: null } as never,
    settingsState: { mutationQueue: Promise.resolve() } as never,
    flushWindowState: async () => undefined,
    flushPanelWindowState: async () => undefined,
    flushBrowserProfile: async () => undefined
  })
  const done = shutdown.releaseRuntimeResources()
  await new Promise((resolve) => setImmediate(resolve))
  expect(calls).toEqual(['history saved', 'history timers stopped', 'site icons timers stopped'])
  stopServer()
  await done
  // The pages' icons are saved with the other stores.
  expect(calls).toEqual(['history saved', 'history timers stopped', 'site icons timers stopped', 'MCP stopped', 'history saved', 'site icons saved'])
})

// A clear of the history or a bookmark removal that ends as Hronaut quits lets go of its pages' icons, so the icons are
// saved only after both files, and a failed save of either is still logged.
it('saves the pages\' icons after the bookmarks and the history, whether or not their saves fail', async () => {
  const saving: { bookmarks?: () => void; history?: (error: Error) => void } = {}
  const bookmarks = { flush: vi.fn(() => new Promise<void>((resolve) => { saving.bookmarks = resolve })) }
  const history = {
    flush: vi.fn<() => Promise<void>>()
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { saving.history = reject })),
    dispose: vi.fn()
  }
  const siteIcons = { flush: vi.fn(async () => undefined), dispose: vi.fn() }
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const done = createRuntimeShutdown({
      tabRuntime: { tabs: null },
      mcpRuntime: { server: null },
      walletRuntime: { service: null, broker: null } as never,
      bookmarksAndHistory: { bookmarks, history, siteIcons } as never,
      agentServices: { auditReceipts: null } as never,
      undoOffers: { close: async () => undefined },
      credentialRuntime: { store: null } as never,
      browserSessionState: { sitePermissionStore: null } as never,
      commercialLicenseRuntime: { store: null } as never,
      settingsState: { mutationQueue: Promise.resolve() } as never,
      flushWindowState: async () => undefined,
      flushPanelWindowState: async () => undefined,
      flushBrowserProfile: async () => undefined
    }).releaseRuntimeResources()
    await vi.waitFor(() => expect(saving.history).toBeDefined())
    saving.history!(new Error('disk full'))
    await new Promise((resolve) => setImmediate(resolve))
    expect(siteIcons.flush).not.toHaveBeenCalled()
    saving.bookmarks!()
    await done
    expect(siteIcons.flush).toHaveBeenCalledTimes(1)
    expect(logged).toHaveBeenCalledWith('[shutdown] Runtime cleanup failed:', new Error('disk full'))
  } finally {
    logged.mockRestore()
  }
})
