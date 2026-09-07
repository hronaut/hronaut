import { computed, ref, watch, type Ref } from 'vue'
import type {
  BrowserState,
  BrowserTabGroupColor,
  BrowserWorkspaceNavigationAuditEntry,
  BrowserWorkspaceNavigationPolicy,
  HronautApi
} from '../../../shared/types.js'
import { suggestWorkspaceName } from '../workspace-names.js'
import { createWorkspaceOriginLoader } from './useWorkspaceOriginLoader.js'

type WorkspaceEditorBrowserApi = Pick<
  HronautApi,
  | 'getState'
  | 'createWorkspace'
  | 'updateTabGroup'
  | 'updateWorkspaceNavigationPolicy'
  | 'listWorkspaceNavigationAudit'
  | 'listWorkspaceStorageOrigins'
  | 'transferWorkspaceStorage'
  | 'closeWorkspace'
>

type Translate = (key: string, parameters?: Record<string, string | number>) => string

export interface WorkspaceEditorControllerOptions {
  state: Readonly<Ref<BrowserState>>
  open: Ref<boolean>
  browser: WorkspaceEditorBrowserApi
  syncState: (next: Promise<BrowserState> | BrowserState) => Promise<void>
  translate: Translate
  formatNumber: (value: number) => string
  confirm: (message: string) => boolean
  canPresent: () => boolean
}

export function useWorkspaceEditorController(options: WorkspaceEditorControllerOptions) {
  const mode = ref<'create' | 'edit' | 'transfer'>('edit')
  const workspaceId = ref<string | null>(null)
  const name = ref('')
  const color = ref<BrowserTabGroupColor>('purple')
  const error = ref('')
  const storageMode = ref<'scratch' | 'fork-default' | 'fork-workspace'>('scratch')
  const sourceWorkspaceId = ref('')
  const targetWorkspaceId = ref('')
  const transferMode = ref<'copy' | 'move'>('copy')
  const agentAccess = ref(true)
  const transferDirection = ref<'from-default' | 'to-default'>('from-default')
  const originOptions = ref<string[]>([])
  const selectedOrigins = ref<string[]>([])
  const storageState = ref<'idle' | 'loading' | 'saving' | 'saved' | 'warning' | 'error'>('idle')
  const storageMessage = ref('')
  const actionState = ref<'idle' | 'saving' | 'closing'>('idle')
  const navigationMode = ref<BrowserWorkspaceNavigationPolicy['mode']>('unrestricted')
  const navigationRulesText = ref('')
  const navigationAudit = ref<BrowserWorkspaceNavigationAuditEntry[]>([])
  const navigationAuditState = ref<'idle' | 'loading' | 'error'>('idle')
  const originLoader = createWorkspaceOriginLoader((id) => options.browser.listWorkspaceStorageOrigins(id))
  let suppressDirectionReload = false
  let presentationGeneration = 0
  let lastSuggestedName = ''

  const workspace = computed(() => options.state.value.mcpTabGroups.find((candidate) => candidate.id === workspaceId.value))
  const availableWorkspaces = computed(() => [
    ...options.state.value.mcpTabGroups.map(group => ({ ...group, archived: false })),
    ...options.state.value.savedTabGroups.map(group => ({ ...group, archived: true }))
  ])
  const targetWorkspaces = availableWorkspaces
  const targetArchived = computed(() => availableWorkspaces.value.find(group => group.id === targetWorkspaceId.value)?.archived === true)
  const sourceArchived = computed(() => availableWorkspaces.value.find(group => group.id === sourceWorkspaceId.value)?.archived === true)
  const validSource = computed(() => availableWorkspaces.value.some(group => group.id === sourceWorkspaceId.value))
  const validTarget = computed(() => targetWorkspaces.value.some(group => group.id === targetWorkspaceId.value))
  const isDefault = computed(() => workspace.value?.isDefault === true)
  const actionPending = computed(() => actionState.value !== 'idle')
  const dismissBlocked = computed(() => actionPending.value || storageState.value === 'saving')
  const saveDisabled = computed(() => (
    dismissBlocked.value
    || !name.value.trim()
    || (navigationMode.value === 'restricted' && navigationRules().length === 0)
    || (mode.value === 'create'
      && storageMode.value !== 'scratch'
      && (!validSource.value || storageState.value === 'loading' || storageState.value === 'error'))
  ))

  const transferDisabled = computed(() => dismissBlocked.value || storageState.value === 'loading' || storageState.value === 'error'
    || !validSource.value || !validTarget.value || sourceWorkspaceId.value === targetWorkspaceId.value
    || (transferMode.value === 'move' && (!sourceArchived.value || !targetArchived.value)))

  function beginPresentation(): number {
    presentationGeneration += 1
    originLoader.invalidate()
    actionState.value = 'idle'
    return presentationGeneration
  }

  function isPresentationCurrent(generation: number): boolean {
    return generation === presentationGeneration
  }

  function finishAndClose(): void {
    beginPresentation()
    options.open.value = false
    workspaceId.value = null
    error.value = ''
    storageState.value = 'idle'
    storageMessage.value = ''
    navigationAudit.value = []
    navigationAuditState.value = 'idle'
  }

  function close(): void {
    if (dismissBlocked.value) return
    finishAndClose()
  }

  async function loadOrigins(browserState = options.state.value): Promise<void> {
    const sourceId = [...browserState.mcpTabGroups, ...browserState.savedTabGroups].find(candidate => candidate.id === sourceWorkspaceId.value)?.id
    if (!sourceId) {
      originLoader.invalidate()
      originOptions.value = []
      selectedOrigins.value = []
      storageState.value = 'idle'
      return
    }
    storageState.value = 'loading'
    storageMessage.value = ''
    const result = await originLoader.load(sourceId)
    if (result.status === 'stale') return
    if (result.status === 'ready') {
      originOptions.value = result.origins
      selectedOrigins.value = [...result.origins]
      storageState.value = 'idle'
      return
    }
    originOptions.value = []
    selectedOrigins.value = []
    storageState.value = 'error'
    storageMessage.value = result.error instanceof Error ? result.error.message : String(result.error)
  }

  async function openExisting(id: string): Promise<void> {
    const presentation = beginPresentation()
    options.open.value = false
    workspaceId.value = null
    error.value = ''
    storageState.value = 'idle'
    storageMessage.value = ''
    const next = await options.browser.getState()
    if (!isPresentationCurrent(presentation)) return
    await options.syncState(next)
    if (!isPresentationCurrent(presentation)) return
    const group = next.mcpTabGroups.find((candidate) => candidate.id === id)
    if (!group || !options.canPresent()) return
    mode.value = 'edit'
    options.open.value = true
    workspaceId.value = id
    name.value = group.name
    color.value = group.color
    agentAccess.value = group.agentAccess !== false
    navigationMode.value = group.navigationPolicy.mode
    navigationRulesText.value = group.navigationPolicy.rules.join('\n')
    navigationAudit.value = []
    navigationAuditState.value = 'loading'
    error.value = ''
    suppressDirectionReload = true
    transferDirection.value = 'from-default'
    transferMode.value = 'copy'
    sourceWorkspaceId.value = next.mcpTabGroups.find(candidate => candidate.id !== id)?.id ?? ''
    targetWorkspaceId.value = id
    suppressDirectionReload = false
    storageMessage.value = ''
    const auditPromise = options.browser.listWorkspaceNavigationAudit(id)
          .then((entries) => {
            if (!isPresentationCurrent(presentation)) return
            navigationAudit.value = entries
            navigationAuditState.value = 'idle'
          })
          .catch(() => {
            if (isPresentationCurrent(presentation)) navigationAuditState.value = 'error'
          })
    await Promise.all([loadOrigins(next), auditPromise])
  }

  async function openNew(): Promise<void> {
    if (!options.canPresent()) return
    beginPresentation()
    mode.value = 'create'
    options.open.value = true
    workspaceId.value = null
    name.value = suggestWorkspaceName([
      ...options.state.value.mcpTabGroups.map(group => group.name),
      ...options.state.value.savedTabGroups.map(group => group.name),
      lastSuggestedName
    ])
    lastSuggestedName = name.value
    color.value = 'purple'
    agentAccess.value = true
    navigationMode.value = 'unrestricted'
    navigationRulesText.value = ''
    navigationAudit.value = []
    navigationAuditState.value = 'idle'
    error.value = ''
    storageMode.value = 'scratch'
    suppressDirectionReload = true
    transferDirection.value = 'from-default'
    transferMode.value = 'copy'
    sourceWorkspaceId.value = options.state.value.mcpTabGroups.find(group => group.isDefault)?.id
      ?? availableWorkspaces.value[0]?.id ?? ''
    targetWorkspaceId.value = ''
    suppressDirectionReload = false
    storageMessage.value = ''
    await loadOrigins()
  }

  async function openTransfer(): Promise<void> {
    const presentation = beginPresentation()
    options.open.value = false
    let next: BrowserState
    try {
      next = await options.browser.getState()
    } catch (cause) {
      if (!isPresentationCurrent(presentation) || !options.canPresent()) return
      mode.value = 'transfer'
      workspaceId.value = null
      sourceWorkspaceId.value = ''
      targetWorkspaceId.value = ''
      storageState.value = 'error'
      storageMessage.value = ''
      error.value = cause instanceof Error ? cause.message : String(cause)
      options.open.value = true
      return
    }
    if (!isPresentationCurrent(presentation)) return
    await options.syncState(next)
    if (!isPresentationCurrent(presentation) || !options.canPresent()) return
    mode.value = 'transfer'
    workspaceId.value = null
    name.value = ''
    error.value = ''
    storageState.value = 'idle'
    storageMessage.value = ''
    transferMode.value = 'copy'
    suppressDirectionReload = true
    sourceWorkspaceId.value = next.savedTabGroups[0]?.id ?? availableWorkspaces.value[0]?.id ?? ''
    targetWorkspaceId.value = next.savedTabGroups.find(group => group.id !== sourceWorkspaceId.value)?.id
      ?? availableWorkspaces.value.find(group => group.id !== sourceWorkspaceId.value)?.id ?? ''
    suppressDirectionReload = false
    options.open.value = true
    await loadOrigins(next)
  }

  function transferOrigins(): string[] | undefined {
    const available = new Set(originOptions.value)
    const selected = [...new Set(selectedOrigins.value.filter((origin) => available.has(origin)))]
    return selected.length === available.size && selected.every((origin) => available.has(origin))
      ? undefined
      : selected
  }

  function navigationRules(): string[] {
    return [...new Set(navigationRulesText.value
      .split(/\r?\n/)
      .map((rule) => rule.trim())
      .filter(Boolean))]
  }

  function navigationPolicy(): BrowserWorkspaceNavigationPolicy {
    return navigationMode.value === 'restricted'
      ? { mode: 'restricted', rules: navigationRules() }
      : { mode: 'unrestricted', rules: [] }
  }

  function toggleAllOrigins(): void {
    selectedOrigins.value = selectedOrigins.value.length === originOptions.value.length
      ? []
      : [...originOptions.value]
  }

  async function save(): Promise<void> {
    if (saveDisabled.value) return
    const presentation = presentationGeneration
    const currentMode = mode.value
    const currentWorkspaceId = workspaceId.value
    actionState.value = 'saving'
    error.value = ''
    try {
      if (currentMode === 'create') {
        await options.syncState(options.browser.createWorkspace({
          name: name.value,
          color: color.value,
          storage: storageMode.value,
          ...(storageMode.value !== 'scratch' ? { origins: transferOrigins() } : {}),
          ...(storageMode.value === 'fork-workspace' ? { sourceWorkspaceId: sourceWorkspaceId.value } : {}),
          agentAccess: agentAccess.value,
          navigationPolicy: navigationPolicy()
        }))
      } else if (currentWorkspaceId) {
        const updated = await options.browser.updateTabGroup(currentWorkspaceId, {
          name: name.value,
          color: color.value,
          agentAccess: agentAccess.value
        })
        if (!isPresentationCurrent(presentation)) return
        const currentPolicy = workspace.value?.navigationPolicy
        const nextPolicy = navigationPolicy()
        const state = currentPolicy
          && JSON.stringify(currentPolicy) === JSON.stringify(nextPolicy)
          ? updated
          : await options.browser.updateWorkspaceNavigationPolicy(currentWorkspaceId, nextPolicy)
        await options.syncState(state)
      }
      if (!isPresentationCurrent(presentation)) return
      finishAndClose()
    } catch (cause) {
      if (!isPresentationCurrent(presentation)) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      actionState.value = 'idle'
    }
  }

  async function transferStorage(): Promise<void> {
    if ((mode.value !== 'transfer' && !workspaceId.value) || transferDisabled.value) return
    const presentation = presentationGeneration
    const currentSource = sourceWorkspaceId.value
    const currentTarget = targetWorkspaceId.value
    const currentMode = transferMode.value
    if (currentMode === 'move' && !options.confirm(options.translate('workspaceEditor.moveConfirm', {
      source: availableWorkspaces.value.find(group => group.id === currentSource)!.name,
      target: availableWorkspaces.value.find(group => group.id === currentTarget)!.name
    }))) return
    const currentOrigins = transferOrigins()
    storageState.value = 'saving'
    storageMessage.value = ''
    let result: Awaited<ReturnType<WorkspaceEditorBrowserApi['transferWorkspaceStorage']>>
    try {
      result = await options.browser.transferWorkspaceStorage({
        sourceWorkspaceId: currentSource,
        targetWorkspaceId: currentTarget,
        mode: currentMode,
        origins: currentOrigins
      })
    } catch (cause) {
      if (!isPresentationCurrent(presentation)) return
      storageState.value = 'error'
      storageMessage.value = cause instanceof Error ? cause.message : String(cause)
      return
    }
    if (!isPresentationCurrent(presentation)) return
    const successMessage = options.translate(result.cleanupStatus === 'incomplete'
      ? 'workspaceEditor.moveIncomplete'
      : currentMode === 'move' ? 'workspaceEditor.moved' : 'runtimeActions.workspace.copied', {
      cookies: options.formatNumber(result.cookieCount),
      items: options.formatNumber(result.localStorageItemCount)
    })
    try {
      await options.syncState(options.browser.getState())
    } catch {
      // The storage copy is authoritative. A failed follow-up refresh must not
      // report the already-completed operation as failed.
    }
    if (!isPresentationCurrent(presentation)) return
    if (currentMode === 'move') {
      const refreshed = await originLoader.load(currentSource)
      if (!isPresentationCurrent(presentation)) return
      if (refreshed.status === 'ready') {
        originOptions.value = refreshed.origins
        selectedOrigins.value = [...refreshed.origins]
      }
    }
    storageState.value = result.cleanupStatus === 'incomplete' ? 'warning' : 'saved'
    storageMessage.value = successMessage
  }

  async function closeWorkspace(): Promise<void> {
    const current = workspace.value
    if (!current || actionPending.value || storageState.value === 'saving') return
    if (options.state.value.allHumanInteractionLocked) {
      error.value = options.translate('runtime.workspace.unlock')
      return
    }
    if (!options.confirm(options.translate('runtimeActions.workspace.closeConfirm', { name: current.name }))) return
    const presentation = presentationGeneration
    actionState.value = 'closing'
    error.value = ''
    try {
      await options.syncState(options.browser.closeWorkspace(current.id))
      if (!isPresentationCurrent(presentation)) return
      finishAndClose()
    } catch (cause) {
      if (!isPresentationCurrent(presentation)) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      actionState.value = 'idle'
    }
  }

  watch(transferDirection, () => {
    if (suppressDirectionReload || !options.open.value || mode.value !== 'edit') return
    const defaultId = options.state.value.mcpTabGroups.find(group => group.isDefault)?.id ?? ''
    sourceWorkspaceId.value = transferDirection.value === 'from-default' ? defaultId : workspaceId.value ?? ''
    targetWorkspaceId.value = transferDirection.value === 'from-default' ? workspaceId.value ?? '' : defaultId
  }, { flush: 'sync' })

  watch(sourceWorkspaceId, () => {
    if (!suppressDirectionReload && options.open.value) void loadOrigins()
  }, { flush: 'sync' })

  function dispose(): void {
    beginPresentation()
  }

  return {
    mode,
    workspaceId,
    name,
    color,
    error,
    storageMode,
    sourceWorkspaceId,
    targetWorkspaceId,
    transferMode,
    agentAccess,
    availableWorkspaces,
    targetWorkspaces,
    sourceArchived,
    targetArchived,
    transferDisabled,
    transferDirection,
    originOptions,
    selectedOrigins,
    storageState,
    storageMessage,
    actionState,
    navigationMode,
    navigationRulesText,
    navigationAudit,
    navigationAuditState,
    actionPending,
    dismissBlocked,
    saveDisabled,
    workspace,
    isDefault,
    openExisting,
    openNew,
    openTransfer,
    close,
    save,
    transferStorage,
    closeWorkspace,
    toggleAllOrigins,
    loadOrigins,
    dispose
  }
}
