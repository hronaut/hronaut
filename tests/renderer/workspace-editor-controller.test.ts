import { ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceEditorController } from '../../src/renderer/src/composables/useWorkspaceEditorController.js'
import type {
  BrowserState,
  BrowserTabGroupState,
  BrowserTabGroupUpdate,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceNavigationPolicy,
  BrowserWorkspaceStorageTransferOptions
} from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function workspace(id: string, name: string, isDefault = false): BrowserTabGroupState {
  return {
    id,
    name,
    color: isDefault ? 'blue' : 'purple',
    createdAt: '2026-08-22T00:00:00.000Z',
    lastUsedAt: '2026-08-22T00:00:00.000Z',
    tabCount: 0,
    activeTabId: null,
    isDefault,
    storageKind: isDefault ? 'default' : 'isolated',
    storageOriginCount: isDefault ? 2 : 1,
    navigationPolicy: isDefault
      ? { mode: 'unrestricted', rules: [] }
      : { mode: 'restricted', rules: ['https://agent.example'] }
  }
}

function browserState(locked = false): BrowserState {
  return {
    tabs: [],
    closedTabs: [],
    activeTabId: null,
    allHumanInteractionLocked: locked,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [workspace('default', 'Default', true), workspace('agent', 'Agent workspace')],
    savedTabGroups: []
  }
}

function createController(initialState = browserState()) {
  const state: Ref<BrowserState> = ref(initialState)
  const open = ref(false)
  const canPresent = ref(true)
  const confirm = vi.fn(() => true)
  const browser = {
    getState: vi.fn(async () => state.value),
    createWorkspace: vi.fn(async (_options: BrowserWorkspaceCreateOptions) => state.value),
    updateTabGroup: vi.fn(async (_id: string, _updates: BrowserTabGroupUpdate) => state.value),
    updateWorkspaceNavigationPolicy: vi.fn(async (_id: string, _policy: BrowserWorkspaceNavigationPolicy) => state.value),
    listWorkspaceNavigationAudit: vi.fn(async (_id: string): Promise<BrowserWorkspaceNavigationAuditEntry[]> => [{
      id: '01912345-6789-7abc-8def-0123456789ab',
      timestamp: '2026-08-22T00:00:00.000Z',
      targetOrigin: 'https://blocked.example',
      reason: 'no-match',
      source: 'page'
    }]),
    listWorkspaceStorageOrigins: vi.fn(async (id: string) => id === 'default'
      ? ['https://default.example', 'https://shared.example']
      : ['https://agent.example']),
    transferWorkspaceStorage: vi.fn(async (options: BrowserWorkspaceStorageTransferOptions) => ({
      workspaceId: options.workspaceId,
      direction: options.direction,
      cookieCount: 2,
      localStorageOriginCount: 1,
      localStorageItemCount: 3,
      origins: options.origins ?? []
    })),
    closeWorkspace: vi.fn(async (_id: string) => state.value)
  }
  const syncState = vi.fn(async (next: Promise<BrowserState> | BrowserState) => {
    state.value = await Promise.resolve(next)
  })
  const controller = useWorkspaceEditorController({
    state,
    open,
    browser,
    syncState,
    translate: (key, parameters) => parameters ? `${key}:${JSON.stringify(parameters)}` : key,
    formatNumber: (value) => String(value),
    confirm,
    canPresent: () => canPresent.value
  })
  return { state, open, canPresent, confirm, browser, syncState, controller }
}

describe('workspace editor controller', () => {
  it('keeps the latest workspace when editor state requests resolve out of order', async () => {
    const { state, open, browser, controller } = createController()
    state.value = {
      ...state.value,
      mcpTabGroups: [...state.value.mcpTabGroups, workspace('other', 'Other workspace')]
    }
    const older = deferred<BrowserState>()
    browser.getState
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(state.value)

    const openingOlder = controller.openExisting('agent')
    await controller.openExisting('other')
    older.resolve(state.value)
    await openingOlder

    expect(open.value).toBe(true)
    expect(controller.workspaceId.value).toBe('other')
    expect(controller.name.value).toBe('Other workspace')
    controller.dispose()
  })

  it('does not reopen an editor that closes while its state request is pending', async () => {
    const { state, open, browser, controller } = createController()
    const pending = deferred<BrowserState>()
    browser.getState.mockReturnValueOnce(pending.promise)

    const opening = controller.openExisting('agent')
    controller.close()
    pending.resolve(state.value)
    await opening

    expect(open.value).toBe(false)
    expect(controller.workspaceId.value).toBeNull()
    controller.dispose()
  })

  it('does not open over a newer competing modal while its state request is pending', async () => {
    const { state, open, canPresent, browser, controller } = createController()
    const pending = deferred<BrowserState>()
    browser.getState.mockReturnValueOnce(pending.promise)

    const opening = controller.openExisting('agent')
    canPresent.value = false
    pending.resolve(state.value)
    await opening

    expect(open.value).toBe(false)
    expect(controller.workspaceId.value).toBeNull()
    controller.dispose()
  })

  it('hides the previous editor while a different workspace request is pending', async () => {
    const { state, open, browser, controller } = createController()
    await controller.openExisting('agent')
    const pending = deferred<BrowserState>()
    browser.getState.mockReturnValueOnce(pending.promise)

    const openingDefault = controller.openExisting('default')

    expect(open.value).toBe(false)
    expect(controller.workspaceId.value).toBeNull()
    pending.resolve(state.value)
    await openingDefault
    expect(open.value).toBe(true)
    expect(controller.workspaceId.value).toBe('default')
    controller.dispose()
  })

  it('does not close a newer editor when an older save finishes', async () => {
    const { state, open, browser, controller } = createController()
    await controller.openExisting('agent')
    const pending = deferred<BrowserState>()
    browser.updateTabGroup.mockReturnValueOnce(pending.promise)

    const saving = controller.save()
    await controller.openNew()
    pending.resolve(state.value)
    await saving

    expect(open.value).toBe(true)
    expect(controller.mode.value).toBe('create')
    expect(controller.workspaceId.value).toBeNull()
    expect(controller.name.value).toBe('runtime.workspace.newName')
    controller.dispose()
  })

  it('serializes repeated save requests from the same editor presentation', async () => {
    const { state, browser, controller } = createController()
    await controller.openExisting('agent')
    const pending = deferred<BrowserState>()
    browser.updateTabGroup.mockReturnValueOnce(pending.promise)

    const firstSave = controller.save()
    const repeatedSave = controller.save()

    expect(controller.actionPending.value).toBe(true)
    expect(browser.updateTabGroup).toHaveBeenCalledOnce()
    pending.resolve(state.value)
    await Promise.all([firstSave, repeatedSave])
    expect(browser.updateTabGroup).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('keeps the editor visible while an authoritative workspace save is in flight', async () => {
    const { state, open, browser, controller } = createController()
    await controller.openExisting('agent')
    const pending = deferred<BrowserState>()
    browser.updateTabGroup.mockReturnValueOnce(pending.promise)

    const saving = controller.save()
    controller.close()

    expect(controller.actionPending.value).toBe(true)
    expect(open.value).toBe(true)
    expect(controller.workspaceId.value).toBe('agent')

    pending.resolve(state.value)
    await saving
    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('does not fork all Default data while the origin inventory is unresolved', async () => {
    const { browser, controller } = createController()
    const pendingOrigins = deferred<string[]>()
    browser.listWorkspaceStorageOrigins.mockReturnValueOnce(pendingOrigins.promise)

    const opening = controller.openNew()
    controller.storageMode.value = 'fork-default'
    await controller.save()

    expect(controller.storageState.value).toBe('loading')
    expect(controller.saveDisabled.value).toBe(true)
    expect(browser.createWorkspace).not.toHaveBeenCalled()
    pendingOrigins.resolve(['https://default.example'])
    await opening
    expect(controller.saveDisabled.value).toBe(false)
    controller.dispose()
  })

  it('creates a Default-forked workspace with only explicitly selected origins', async () => {
    const { open, browser, syncState, controller } = createController()
    await controller.openNew()
    controller.name.value = 'Focused fork'
    controller.storageMode.value = 'fork-default'
    controller.selectedOrigins.value = ['https://shared.example']

    await controller.save()

    expect(browser.createWorkspace).toHaveBeenCalledWith({
      name: 'Focused fork',
      color: 'purple',
      storage: 'fork-default',
      origins: ['https://shared.example'],
      navigationPolicy: { mode: 'unrestricted', rules: [] }
    })
    expect(syncState).toHaveBeenCalledOnce()
    expect(open.value).toBe(false)
    controller.dispose()
  })

  it('reloads the source inventory when transfer direction changes and saves through syncState', async () => {
    const { browser, syncState, controller } = createController()
    await controller.openExisting('agent')
    expect(browser.listWorkspaceStorageOrigins).toHaveBeenCalledTimes(1)
    expect(browser.listWorkspaceStorageOrigins).toHaveBeenLastCalledWith('default')

    controller.transferDirection.value = 'to-default'
    await vi.waitFor(() => expect(browser.listWorkspaceStorageOrigins).toHaveBeenLastCalledWith('agent'))
    await vi.waitFor(() => expect(controller.originOptions.value).toEqual(['https://agent.example']))
    await controller.transferStorage()

    expect(browser.transferWorkspaceStorage).toHaveBeenCalledWith({
      workspaceId: 'agent',
      direction: 'to-default',
      origins: undefined
    })
    expect(controller.storageState.value).toBe('saved')
    expect(controller.storageMessage.value).toContain('"cookies":"2"')
    expect(syncState).toHaveBeenCalledTimes(2)
    controller.dispose()
  })

  it('keeps a completed storage transfer successful when the follow-up state refresh fails', async () => {
    const { browser, controller } = createController()
    await controller.openExisting('agent')
    browser.getState.mockRejectedValueOnce(new Error('Could not refresh workspace state'))

    await controller.transferStorage()

    expect(browser.transferWorkspaceStorage).toHaveBeenCalledOnce()
    expect(controller.storageState.value).toBe('saved')
    expect(controller.storageMessage.value).toContain('runtimeActions.workspace.copied')
    controller.dispose()
  })

  it('does not start a duplicate transfer while the successful copy is refreshing state', async () => {
    const { state, browser, controller } = createController()
    await controller.openExisting('agent')
    const pendingRefresh = deferred<BrowserState>()
    browser.getState.mockReturnValueOnce(pendingRefresh.promise)

    const transferring = controller.transferStorage()
    await vi.waitFor(() => expect(browser.getState).toHaveBeenCalledTimes(2))
    await controller.transferStorage()

    expect(browser.transferWorkspaceStorage).toHaveBeenCalledOnce()
    pendingRefresh.resolve(state.value)
    await transferring
    expect(controller.storageState.value).toBe('saved')
    controller.dispose()
  })

  it('keeps the editor visible while an authoritative storage transfer is in flight', async () => {
    const { open, browser, controller } = createController()
    await controller.openExisting('agent')
    const pending = deferred<Awaited<ReturnType<typeof browser.transferWorkspaceStorage>>>()
    browser.transferWorkspaceStorage.mockReturnValueOnce(pending.promise)

    const transferring = controller.transferStorage()
    controller.close()

    expect(controller.storageState.value).toBe('saving')
    expect(open.value).toBe(true)
    expect(controller.workspaceId.value).toBe('agent')

    pending.resolve({
      workspaceId: 'agent', direction: 'from-default', cookieCount: 1,
      localStorageOriginCount: 1, localStorageItemCount: 1, origins: []
    })
    await transferring
    expect(controller.storageState.value).toBe('saved')
    expect(open.value).toBe(true)
    controller.dispose()
  })

  it('does not save or dismiss while an authoritative storage transfer is in flight', async () => {
    const { open, browser, controller } = createController()
    await controller.openExisting('agent')
    const pending = deferred<Awaited<ReturnType<typeof browser.transferWorkspaceStorage>>>()
    browser.transferWorkspaceStorage.mockReturnValueOnce(pending.promise)

    const transferring = controller.transferStorage()
    await controller.save()

    expect(controller.saveDisabled.value).toBe(true)
    expect(browser.updateTabGroup).not.toHaveBeenCalled()
    expect(open.value).toBe(true)

    pending.resolve({
      workspaceId: 'agent', direction: 'from-default', cookieCount: 1,
      localStorageOriginCount: 1, localStorageItemCount: 1, origins: []
    })
    await transferring
    controller.dispose()
  })

  it('blocks permanent close while global human interaction is locked', async () => {
    const { confirm, browser, controller } = createController(browserState(true))
    await controller.openExisting('agent')
    await controller.closeWorkspace()

    expect(confirm).not.toHaveBeenCalled()
    expect(browser.closeWorkspace).not.toHaveBeenCalled()
    expect(controller.error.value).toBe('runtime.workspace.unlock')
    controller.dispose()
  })

  it('creates a restricted workspace from one rule per line', async () => {
    const { browser, controller } = createController()
    await controller.openNew()
    controller.name.value = 'Production QA'
    controller.navigationMode.value = 'restricted'
    controller.navigationRulesText.value = 'https://app.example\n*.trusted.example\n\nhttps://app.example'

    await controller.save()

    expect(browser.createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      navigationPolicy: {
        mode: 'restricted',
        rules: ['https://app.example', '*.trusted.example']
      }
    }))
    controller.dispose()
  })

  it('loads a workspace policy and its origin-only denied-navigation audit', async () => {
    const { browser, controller } = createController()

    await controller.openExisting('agent')

    expect(controller.navigationMode.value).toBe('restricted')
    expect(controller.navigationRulesText.value).toBe('https://agent.example')
    expect(browser.listWorkspaceNavigationAudit).toHaveBeenCalledWith('agent')
    expect(controller.navigationAudit.value).toEqual([
      expect.objectContaining({ targetOrigin: 'https://blocked.example', reason: 'no-match' })
    ])
    controller.dispose()
  })

  it('persists a changed site-access policy through the trusted shell API', async () => {
    const { browser, controller } = createController()
    await controller.openExisting('agent')
    controller.navigationRulesText.value = 'https://agent.example\nhttp://localhost:*'

    await controller.save()

    expect(browser.updateWorkspaceNavigationPolicy).toHaveBeenCalledWith('agent', {
      mode: 'restricted',
      rules: ['https://agent.example', 'http://localhost:*']
    })
    controller.dispose()
  })

  it('does not submit a restricted policy without any site rules', async () => {
    const { browser, controller } = createController()
    await controller.openNew()
    controller.navigationMode.value = 'restricted'
    controller.navigationRulesText.value = ' \n '

    await controller.save()

    expect(controller.saveDisabled.value).toBe(true)
    expect(browser.createWorkspace).not.toHaveBeenCalled()
    controller.dispose()
  })
})
