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
  const shutdown = createRuntimeShutdown({
    tabRuntime: { tabs: null },
    mcpRuntime: { server: { stop: () => new Promise<void>((resolve) => { stopServer = () => { calls.push('MCP stopped'); resolve() } }) } as never },
    walletRuntime: { service: null, broker: null } as never,
    bookmarksAndHistory: { bookmarks: null, history } as never,
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
  expect(calls).toEqual(['history saved', 'history timers stopped'])
  stopServer()
  await done
  expect(calls).toEqual(['history saved', 'history timers stopped', 'MCP stopped', 'history saved'])
})
