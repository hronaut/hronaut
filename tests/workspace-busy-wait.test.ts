import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
const changes = vi.hoisted(() => ({ update: vi.fn(), rename: vi.fn(), policy: vi.fn(async () => ({ policy: true })) }))
vi.mock('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')>(),
  updateMcpTabGroup: changes.update,
  renameMcpTabGroup: changes.rename
}))
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  updateWorkspaceNavigationPolicy: changes.policy
}))
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  browserState: () => ({ state: true })
}))

const { whenWorkspaceIdle, withWorkspaceOperation } = await import('../src/main/browser/workspace-operations/workspace-operations.js')
const { registerWorkspacesIpc } = await import('../src/main/workspaces-ipc.js')
const { WORKSPACES_IPC } = await import('../src/shared/ipc/workspaces.js')

/** A browser with one open workspace, with no operation holding it busy yet. */
function workspaceBrowser() {
  return {
    mcpTabGroups: new Map([['research', { id: 'research', name: 'Research' }]]),
    workspaceOperations: new Map(),
    savedWorkspaceOperations: new Map(),
    savedTabGroups: new Map(),
    pendingWorkspaceOperationPromises: new Set()
  }
}

/** An operation of the workspace that runs until `end` is called. */
function heldOperation(browser: ReturnType<typeof workspaceBrowser>) {
  let end!: () => void
  const running = withWorkspaceOperation(browser as never, 'research', 'copying workspace data', () => new Promise<void>(resolve => { end = resolve }))
  return { running, end: () => end() }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 10))

describe('waiting for a busy workspace', () => {
  it('resolves at once for a workspace no operation holds', async () => {
    await expect(whenWorkspaceIdle(workspaceBrowser() as never, 'research')).resolves.toBeUndefined()
  })

  it('waits for the operation that holds it, and is released once it ends', async () => {
    const browser = workspaceBrowser()
    const operation = heldOperation(browser)
    let idle = false
    const waiting = whenWorkspaceIdle(browser as never, 'research').then(() => { idle = true })
    await tick()
    expect(idle).toBe(false)
    operation.end()
    await waiting
    expect(browser.workspaceOperations.has('research')).toBe(false)
  })

  it('also waits for an operation that already holds it when an earlier wait ends', async () => {
    const browser = workspaceBrowser()
    const first = heldOperation(browser)
    // A later operation took the workspace over before the first one released it.
    const settledFirst = browser.workspaceOperations.get('research')!.settled as Promise<void>
    let endSecond!: () => void
    const second = { action: 'clearing website data', blocksNewTabs: true, token: Symbol('second'), settled: new Promise<void>(resolve => { endSecond = resolve }) }
    let idle = false
    const waiting = whenWorkspaceIdle(browser as never, 'research').then(() => { idle = true })
    browser.workspaceOperations.set('research', second)
    first.end()
    await settledFirst
    await tick()
    expect(idle).toBe(false)
    browser.workspaceOperations.delete('research')
    endSecond()
    await waiting
  })
})

describe("a person's workspace change while the workspace is busy", () => {
  function registered(browser: ReturnType<typeof workspaceBrowser>) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    registerWorkspacesIpc({
      assertTrustedSender: () => undefined,
      handleBrowserIpc: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => { handlers.set(channel, handler) },
      tabs: () => browser
    } as never)
    return (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args)
  }

  it('applies a switch, a rename and a navigation policy once the operation ends, instead of refusing them', async () => {
    changes.update.mockClear()
    changes.rename.mockClear()
    changes.policy.mockClear()
    const browser = workspaceBrowser()
    const invoke = registered(browser)
    const operation = heldOperation(browser)
    const switched = invoke(WORKSPACES_IPC.update, 'research', { agentAccess: false })
    const renamed = invoke(WORKSPACES_IPC.rename, 'research', 'Notes')
    const restricted = invoke(WORKSPACES_IPC.updateNavigationPolicy, 'research', { mode: 'unrestricted', rules: [] })
    await tick()
    expect(changes.update).not.toHaveBeenCalled()
    expect(changes.rename).not.toHaveBeenCalled()
    expect(changes.policy).not.toHaveBeenCalled()
    operation.end()
    await expect(switched).resolves.toEqual({ state: true })
    await expect(renamed).resolves.toEqual({ state: true })
    await expect(restricted).resolves.toEqual({ policy: true })
    expect(changes.update).toHaveBeenCalledExactlyOnceWith(browser, 'research', { agentAccess: false })
    expect(changes.rename).toHaveBeenCalledExactlyOnceWith(browser, 'research', 'Notes')
    expect(changes.policy).toHaveBeenCalledOnce()
  })
})
