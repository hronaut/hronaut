import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' } }))
// The prototype-built browser below stubs changed, getState, persistedState and assertWorkspaceNavigationAllowed, which
// opening a labeled tab publishes, saves and checks the workspace's sites through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist),
  browserState: (browser: { getState: () => unknown }) => browser.getState()
}))
vi.mock('../src/main/browser/browser-state/persisted-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/persisted-state.js')>(),
  persistedState: (browser: { persistedState: () => unknown }) => browser.persistedState()
}))
vi.mock('../src/main/browser/workspace-navigation/workspace-navigation.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/workspace-navigation/workspace-navigation.js')>(),
  assertWorkspaceNavigationAllowed: (browser: { assertWorkspaceNavigationAllowed: (...args: unknown[]) => void }, ...args: unknown[]) => (
    browser.assertWorkspaceNavigationAllowed(...args)
  )
}))
import { Browser } from '../src/main/browser/browser.js'

function fixture() {
  const tab = { id: 'owned', title: 'Page', url: 'https://example.test/', mcpGroupId: 'workspace', label: undefined as string | undefined }
  let snapshot!: () => unknown
  let hooks!: { beforeCommit(): void; onCommitted(): void }
  let resolve!: () => void
  let reject!: (error: Error) => void
  const save = vi.fn((capture: () => unknown, callbacks: typeof hooks) => {
    snapshot = capture; hooks = callbacks
    return new Promise<void>((pass, fail) => { resolve = pass; reject = fail })
  })
  const pending = new Set<Promise<unknown>>()
  const createTab = vi.fn(async (options: { onCreated?: (created: { id: string; title: string; url: string; mcpGroupId: string; label: string | undefined }) => void; onCreationAttempt?: () => void }) => {
    options.onCreationAttempt?.()
    options.onCreated?.(tab)
    return tab
  })
  const manager = Object.assign(Object.create(Browser.prototype), {
    initialized: true, destroyed: false, tabLabelAdmissionClosed: false, tabLabelLifecycleHolds: 0,
    pendingTabLabels: pending, tabs: new Map([[tab.id, tab]]), mcpTabGroups: new Map([['workspace', {}]]), store: { save },
    options: {}, followAgentActivity: false, createTab, changed: vi.fn(),
    getState: () => ({ tabs: [tab] }), requireMcpTabGroup: vi.fn(), assertWorkspaceNavigationAllowed: vi.fn(),
    persistedState: () => ({ version: 3, tabs: [{ ...tab }] })
  }) as Browser
  return { manager, tab, pending, save, createTab, snapshot: () => snapshot(),
    commit: () => { hooks.beforeCommit(); hooks.onCommitted(); resolve() },
    reject: () => reject(new Error('Synthetic precommit failure')),
    directoryFailure: () => { hooks.beforeCommit(); hooks.onCommitted(); reject(new Error('Synthetic flush failure')) } }
}

it('admits a staged save before creation callback or first yield and returns owned identity', async () => {
  const f = fixture()
  const validate = vi.fn()
  const created = vi.fn(id => { expect(id).toBe('owned'); expect(f.pending.size).toBe(1); expect(f.tab.label).toBeUndefined() })
  const operation = f.manager.newLabeledAgentTab({ mcpGroupId: 'workspace' }, '  e\u0301  ', validate, created, vi.fn())
  expect(created).toHaveBeenCalledOnce()
  expect(f.snapshot()).toMatchObject({ tabs: [{ label: 'é' }] })
  expect(f.tab.label).toBeUndefined()
  f.commit()
  expect(await operation).toEqual({ createdTabId: 'owned', labelPersistence: 'saved' })
  expect(f.tab.label).toBe('é')
  expect(f.pending.size).toBe(0)
  expect(validate).toHaveBeenCalledTimes(3)
})

for (const value of ['bad\nlabel', 'a'.repeat(101), '\ud800', 'a'.repeat(1025)]) {
  it(`rejects invalid label before creation (${JSON.stringify(value.slice(0, 12))})`, async () => {
    const f = fixture()
    await expect(f.manager.newLabeledAgentTab({ mcpGroupId: 'workspace' }, value, vi.fn(), vi.fn(), vi.fn())).rejects.toThrow()
    expect(f.createTab).not.toHaveBeenCalled()
    expect(f.save).not.toHaveBeenCalled()
  })
}

for (const mode of ['reject', 'directoryFailure'] as const) {
  it(`retains the created tab and distinguishes ${mode}`, async () => {
    const f = fixture()
    const operation = f.manager.newLabeledAgentTab({ mcpGroupId: 'workspace' }, 'Task', vi.fn(), vi.fn(), vi.fn())
    f.snapshot(); f[mode]()
    expect(await operation).toEqual({ createdTabId: 'owned', labelPersistence: mode === 'reject' ? 'not-saved' : 'durability-unconfirmed' })
    expect(f.tab.label).toBe(mode === 'reject' ? undefined : 'Task')
    expect(f.pending.size).toBe(0)
  })
}

it('rechecks authority at dequeue and before commit while retaining ownership until actual settlement', async () => {
  const f = fixture()
  let authorized = true
  const operation = f.manager.newLabeledAgentTab({ mcpGroupId: 'workspace' }, 'Task', () => { if (!authorized) throw new Error('Revoked') }, vi.fn(), vi.fn())
  f.snapshot()
  authorized = false
  expect(() => f.commit()).toThrow('Revoked')
  expect(f.pending.size).toBe(1)
  expect(f.tab.label).toBeUndefined()
  f.reject()
  expect((await operation).labelPersistence).toBe('not-saved')
  expect(f.pending.size).toBe(0)
})

it('retains admitted persistence ownership if the synchronous creation observer throws', async () => {
  const f = fixture()
  let settled = false
  const operation = f.manager.newLabeledAgentTab({ mcpGroupId: 'workspace' }, 'Owned write', vi.fn(), () => { throw new Error('Observer failure') }, vi.fn())
  const rejected = expect(operation).rejects.toThrow('Observer failure').finally(() => { settled = true })
  await Promise.resolve(); await Promise.resolve()
  expect(settled).toBe(false); expect(f.pending.size).toBe(1)
  f.snapshot(); f.commit()
  await rejected
  expect(f.pending.size).toBe(0); expect(f.tab.label).toBe('Owned write')
})

it('rejects a revoked queued snapshot without releasing its operation early', async () => {
  const f = fixture()
  let allowed = true
  const operation = f.manager.newLabeledAgentTab({ mcpGroupId: 'workspace' }, 'Queued', () => { if (!allowed) throw new Error('Revoked') }, vi.fn(), vi.fn())
  allowed = false
  expect(() => f.snapshot()).toThrow('Revoked')
  expect(f.pending.size).toBe(1)
  f.reject()
  expect((await operation).labelPersistence).toBe('not-saved')
})

it('rejects exhausted label admission before creating any tab', async () => {
  const f = fixture()
  for (let i = 0; i < 8; i++) f.pending.add(new Promise(() => undefined))
  const attempt = vi.fn()
  await expect(f.manager.newLabeledAgentTab({ mcpGroupId: 'workspace' }, 'Busy', vi.fn(), vi.fn(), attempt)).rejects.toThrow('pending label edits')
  expect(f.createTab).not.toHaveBeenCalled(); expect(attempt).not.toHaveBeenCalled()
})
