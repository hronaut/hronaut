import { nextTick, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceEditorController } from '../../src/renderer/src/composables/useWorkspaceEditorController.js'
import type {
  BrowserState,
  BrowserTabGroupState,
  BrowserTabGroupUpdate,
  BrowserWorkspaceCreateOptions,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceNavigationPolicy,
  BrowserWorkspaceStorageTransferOptions,
  BrowserWorkspaceStorageTransferResult
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
    transferWorkspaceStorage: vi.fn(async (options: BrowserWorkspaceStorageTransferOptions): Promise<BrowserWorkspaceStorageTransferResult> => ({
      workspaceId: 'workspaceId' in options ? options.workspaceId : options.targetWorkspaceId,
      direction: 'direction' in options ? options.direction : 'from-default',
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
  it('forks any active workspace with independent direct agent access and selected data', async () => {
    const { controller, browser } = createController()
    await controller.openNew()
    controller.storageMode.value = 'fork-workspace'
    controller.sourceWorkspaceId.value = 'agent'
    await vi.waitFor(() => expect(controller.originOptions.value).toEqual(['https://agent.example']))
    controller.agentAccess.value = false
    await controller.save()
    expect(browser.createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      storage: 'fork-workspace', sourceWorkspaceId: 'agent', agentAccess: false, origins: undefined
    }))
    expect(browser.createWorkspace.mock.calls[0][0]).not.toHaveProperty('tabs')
  })

  it('keeps direct agent access editable and defaults legacy workspaces to allowed', async () => {
    const { controller, browser, state } = createController()
    await controller.openExisting('agent')
    expect(controller.agentAccess.value).toBe(true)
    controller.agentAccess.value = false
    await controller.save()
    expect(browser.updateTabGroup).toHaveBeenCalledWith('agent', expect.objectContaining({ agentAccess: false }))
    state.value.mcpTabGroups[1].agentAccess = false
    await controller.openExisting('agent')
    expect(controller.agentAccess.value).toBe(false)
    await controller.openNew()
    expect(controller.agentAccess.value).toBe(true)
  })

  it('blocks transfers while source inventory is loading and rejects a same or missing destination', async () => {
    const { controller, browser, state } = createController()
    await controller.openExisting('agent')
    const pending = deferred<string[]>()
    browser.listWorkspaceStorageOrigins.mockReturnValueOnce(pending.promise)
    controller.sourceWorkspaceId.value = 'agent'
    controller.targetWorkspaceId.value = 'default'
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).not.toHaveBeenCalled()
    pending.resolve(['https://agent.example'])
    await vi.waitFor(() => expect(controller.storageState.value).toBe('idle'))
    controller.targetWorkspaceId.value = 'agent'
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).not.toHaveBeenCalled()
    controller.targetWorkspaceId.value = 'default'
    state.value.mcpTabGroups = state.value.mcpTabGroups.filter(group => group.id !== 'default')
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).not.toHaveBeenCalled()
  })

  it('requires confirmation before moving data and preserves incomplete cleanup feedback', async () => {
    const { controller, browser, confirm, state } = createController()
    state.value.savedTabGroups = [{ id: 'archived', name: 'Archived workspace', color: 'purple', savedAt: '',
      storageOriginCount: 1, navigationPolicy: { mode: 'unrestricted', rules: [] }, tabs: [] },
    { id: 'archived-target', name: 'Archived destination', color: 'blue', savedAt: '',
      storageOriginCount: 0, navigationPolicy: { mode: 'unrestricted', rules: [] }, tabs: [] }]
    await controller.openExisting('agent')
    controller.sourceWorkspaceId.value = 'archived'
    controller.targetWorkspaceId.value = 'archived-target'
    await vi.waitFor(() => expect(controller.storageState.value).toBe('idle'))
    controller.transferMode.value = 'move'
    confirm.mockReturnValueOnce(false)
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).not.toHaveBeenCalled()
    browser.transferWorkspaceStorage.mockResolvedValueOnce({ workspaceId: 'agent', direction: 'from-default',
      cookieCount: 2, localStorageOriginCount: 1, localStorageItemCount: 3, origins: [], cleanupStatus: 'incomplete' })
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).toHaveBeenCalledWith({ sourceWorkspaceId: 'archived', targetWorkspaceId: 'archived-target', mode: 'move', origins: undefined })
    expect(controller.storageState.value).toBe('warning')
    expect(controller.storageMessage.value).toContain('workspaceEditor.moveIncomplete')
    expect(controller.storageMessage.value).not.toContain('workspaceEditor.moved')
    expect(browser.listWorkspaceStorageOrigins).toHaveBeenCalledTimes(3)
  })

  it('blocks moves from active sources but permits copying the same data', async () => {
    const { controller, browser } = createController()
    await controller.openExisting('agent')
    controller.transferMode.value = 'move'
    await controller.transferStorage()
    expect(controller.transferDisabled.value).toBe(true)
    expect(browser.transferWorkspaceStorage).not.toHaveBeenCalled()
    controller.transferMode.value = 'copy'
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).toHaveBeenCalledOnce()
  })

  it('opens standalone transfer controls with only archived workspaces and never creates a dummy workspace', async () => {
    const { controller, browser, state, open } = createController()
    state.value.mcpTabGroups = []
    state.value.savedTabGroups = ['source', 'target'].map(id => ({ id, name: id, color: 'purple', savedAt: '',
      storageOriginCount: 1, navigationPolicy: { mode: 'unrestricted', rules: [] }, tabs: [] }))
    await controller.openTransfer('target')
    expect(open.value).toBe(true)
    expect(controller.mode.value).toBe('transfer')
    expect(controller.workspaceId.value).toBeNull()
    controller.transferMode.value = 'move'
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).toHaveBeenCalledWith({ sourceWorkspaceId: 'target', targetWorkspaceId: 'source', mode: 'move', origins: undefined })
    expect(browser.createWorkspace).not.toHaveBeenCalled()
    expect(browser.updateTabGroup).not.toHaveBeenCalled()
  })

  it('shows a standalone transfer initialization error without allowing stale data operations', async () => {
    const { controller, browser, open } = createController()
    await controller.openExisting('agent')
    controller.close()
    browser.getState.mockRejectedValueOnce(new Error('Workspace state unavailable'))
    await controller.openTransfer()
    expect(open.value).toBe(true)
    expect(controller.mode.value).toBe('transfer')
    expect(controller.error.value).toBe('Workspace state unavailable')
    expect(controller.transferDisabled.value).toBe(true)
    await controller.transferStorage()
    expect(browser.transferWorkspaceStorage).not.toHaveBeenCalled()
  })

  it('allows renaming and closing a legacy Default workspace', async () => {
    const { controller, browser } = createController()
    await controller.openExisting('default')
    controller.name.value = 'Personal browsing'
    await controller.save()
    expect(browser.updateTabGroup).toHaveBeenCalledWith('default', expect.objectContaining({ name: 'Personal browsing' }))
    await controller.openExisting('default')
    await controller.closeWorkspace()
    expect(browser.closeWorkspace).toHaveBeenCalledWith('default')
  })

  it('uses the latest source inventory when an earlier source load finishes late', async () => {
    const { controller, browser } = createController()
    const pending = deferred<string[]>()
    browser.listWorkspaceStorageOrigins.mockReturnValueOnce(pending.promise)
    const opening = controller.openNew()
    controller.storageMode.value = 'fork-workspace'
    controller.sourceWorkspaceId.value = 'agent'
    await vi.waitFor(() => expect(controller.originOptions.value).toEqual(['https://agent.example']))
    pending.resolve(['https://stale.example'])
    await opening
    expect(controller.originOptions.value).toEqual(['https://agent.example'])
    expect(controller.selectedOrigins.value).toEqual(['https://agent.example'])
  })

  it('suggests a fresh editable name once per new dialog and preserves edits through async loading', async () => {
    const { state, browser, controller } = createController()
    const pendingOrigins = deferred<string[]>()
    browser.listWorkspaceStorageOrigins.mockReturnValueOnce(pendingOrigins.promise)
    const opening = controller.openNew()
    const suggestion = controller.name.value
    expect(suggestion).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/)
    controller.name.value = 'My release checks'
    state.value = { ...state.value, mcpTabGroups: [...state.value.mcpTabGroups, workspace('new', 'Other task')] }
    pendingOrigins.resolve([])
    await opening
    await nextTick()
    expect(controller.name.value).toBe('My release checks')
    await controller.save()
    expect(browser.createWorkspace).toHaveBeenCalledWith(expect.objectContaining({ name: 'My release checks' }))
    await controller.openNew()
    expect(controller.name.value).not.toBe(suggestion)
    expect(controller.name.value).not.toBe('My release checks')
    await controller.openExisting('agent')
    expect(controller.name.value).toBe('Agent workspace')
    controller.dispose()
  })

  it('avoids visible open and archived names when suggesting a new workspace', async () => {
    const { state, controller } = createController()
    const random = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      state.value.mcpTabGroups.push(workspace('same', ' curious otter '))
      state.value.savedTabGroups.push({
        id: 'archive', name: 'CURIOUS OTTER 2', color: 'purple', tabs: [],
        savedAt: '2026-09-05T00:00:00Z', storageOriginCount: 0,
        navigationPolicy: { mode: 'unrestricted', rules: [] }
      })
      await controller.openNew()
      expect(controller.name.value).toBe('Curious Otter 3')
      controller.close()
      await controller.openNew()
      expect(controller.name.value).toBe('Curious Otter 4')
    } finally {
      random.mockRestore()
      controller.dispose()
    }
  })

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
    expect(controller.name.value).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+(?: \d+)?$/)
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
      agentAccess: true,
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
      sourceWorkspaceId: 'agent',
      targetWorkspaceId: 'default',
      mode: 'copy',
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
