import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { LocalizedError } from '../src/main/localized-error.js'
import { registerBrowserNewTab } from '../src/main/mcp/tools/browser-new-tab/index.js'
import { initialPageLoaded } from '../src/main/mcp/tools/browser-new-tab/initial-page-load.js'
import { PAGE_LOAD_WAIT_MS } from '../src/main/browser/page-waits/page-load-limit.js'

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const emptyState = { tabs: [] as Array<{ id: string; url: string }>, closedTabs: [], mcpTabGroups: [], savedTabGroups: [] }

function newTabTool(waitForPage: (tabId: string, timeoutMs: number) => Promise<void>, labelPersistence: 'saved' | 'not-saved' = 'saved') {
  let handler: ((input: Record<string, unknown>, call: unknown) => Promise<CallToolResult>) | undefined
  const state = { ...emptyState, tabs: [] as Array<{ id: string; url: string }> }
  const manager = {
    getState: () => state,
    getMcpGroupState: () => state,
    tabBelongsToMcpGroup: () => true,
    newAgentTab: vi.fn(async ({ url }: { url?: string }) => {
      state.tabs.push({ id: 'created', url: url ?? 'about:blank' })
      return state
    }),
    newLabeledAgentTab: vi.fn(async ({ url }: { url?: string }, _label: string, _validate: () => void, onCreated: (id: string) => void) => {
      state.tabs.push({ id: 'created', url: url ?? 'about:blank' })
      onCreated('created')
      return { createdTabId: 'created', labelPersistence }
    }),
    waitForPage: vi.fn(waitForPage)
  }
  registerBrowserNewTab({
    manager,
    tool: (callback: unknown) => callback,
    workspaceAuthorizationError: () => new Error('Workspace access was withdrawn'),
    registerWorkspaceTool: (_name: string, _config: unknown, callback: typeof handler) => { handler = callback }
  } as never)
  const abort = new AbortController()
  const creation = {
    publication: () => () => undefined,
    retainPublication: () => undefined,
    retainFinish: () => undefined,
    cancelled: () => false,
    markAttempted: () => undefined,
    recordLabelNotSaved: () => undefined
  }
  const run = (input: Record<string, unknown>) => handler!({ workspaceId: 'workspace', ...input }, { signal: abort.signal, settlement: input.label === undefined ? undefined : creation })
  const body = (result: CallToolResult) => JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>
  return { manager, run, body, cancel: () => abort.abort() }
}

async function settledWithinTurns<T>(promise: Promise<T>): Promise<boolean> {
  let settled = false
  void promise.then(() => { settled = true }, () => { settled = true })
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
  return settled
}

describe('browser_new_tab initial page load', () => {
  it('answers only once the page opened at an address stops loading, as browser_navigate does', async () => {
    const load = deferred()
    const { manager, run, body } = newTabTool(() => load.promise)
    const result = run({ url: 'https://example.test/slow' })
    expect(await settledWithinTurns(result)).toBe(false)
    expect(manager.waitForPage).toHaveBeenCalledWith('created', PAGE_LOAD_WAIT_MS)
    load.resolve()
    const answered = body(await result)
    expect(answered).not.toHaveProperty('pageLoad')
    expect(answered).not.toHaveProperty('nextAction')
  })

  it('tells the agent a page still loading at the time limit is not ready, without failing the creation', async () => {
    const { run, body } = newTabTool(async () => { throw new LocalizedError('appErrors.page.loadTimedOut') })
    const result = await run({ url: 'https://example.test/endless' })
    expect(result.isError).toBeUndefined()
    expect(body(result)).toMatchObject({ pageLoad: 'still-loading', nextAction: expect.stringMatching(/browser_wait.*do not repeat creation/u) })
    expect(body(result).tabs).toEqual([{ id: 'created', url: 'https://example.test/endless' }])
  })

  it('answers with the creation when the page fails, closes or loses its renderer while loading', async () => {
    for (const failure of [new LocalizedError('appErrors.page.closedWhileWaiting'), new LocalizedError('appErrors.page.rendererLostWhileWaiting'), new Error('Tab not found')]) {
      const { run, body } = newTabTool(async () => { throw failure })
      const result = await run({ url: 'https://example.test/gone' })
      expect(result.isError).toBeUndefined()
      expect(body(result)).not.toHaveProperty('pageLoad')
    }
  })

  it('stops waiting as soon as the call is cancelled', async () => {
    const { run, body, cancel } = newTabTool(() => new Promise<void>(() => undefined))
    const result = run({ url: 'https://example.test/endless' })
    expect(await settledWithinTurns(result)).toBe(false)
    cancel()
    expect(body(await result)).toMatchObject({ pageLoad: 'still-loading' })
  })

  it('does not wait for a tab opened without an address, or when asked not to', async () => {
    for (const input of [{}, { url: 'https://example.test/endless', waitForLoad: false }, { url: 'https://example.test/endless', waitForLoad: false, label: 'Loading' }]) {
      const { manager, run, body } = newTabTool(() => new Promise<void>(() => undefined))
      expect(body(await run(input))).not.toHaveProperty('pageLoad')
      expect(manager.waitForPage).not.toHaveBeenCalled()
    }
  })

  it('waits for a labeled tab\'s page too, and keeps the unsaved label\'s advice first', async () => {
    const load = deferred()
    const labeled = newTabTool(() => load.promise)
    const result = labeled.run({ url: 'https://example.test/slow', label: 'Checkout' })
    expect(await settledWithinTurns(result)).toBe(false)
    load.resolve()
    expect(labeled.body(await result)).toMatchObject({ status: 'CREATED', createdTabId: 'created' })
    expect(labeled.body(await result)).not.toHaveProperty('pageLoad')

    const unsaved = newTabTool(async () => { throw new LocalizedError('appErrors.page.loadTimedOut') }, 'not-saved')
    const unsavedResult = await unsaved.run({ url: 'https://example.test/endless', label: 'Checkout' })
    expect(unsaved.body(unsavedResult)).toMatchObject({ status: 'LABEL_NOT_SAVED', pageLoad: 'still-loading', nextAction: expect.stringMatching(/label was not saved/u) })
  })
})

describe('initialPageLoaded', () => {
  it('removes its cancellation listener once the page loads', async () => {
    const abort = new AbortController()
    const remove = vi.spyOn(abort.signal, 'removeEventListener')
    expect(await initialPageLoaded({ waitForPage: async () => undefined }, 'tab', abort.signal)).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('does not start waiting for a call already cancelled', async () => {
    const abort = new AbortController()
    abort.abort()
    const waitForPage = vi.fn(async () => undefined)
    expect(await initialPageLoaded({ waitForPage }, 'tab', abort.signal)).toBe(false)
    expect(waitForPage).not.toHaveBeenCalled()
  })
})
