import { computed, ref, watch, type Ref } from 'vue'
import type {
  BrowserState,
  BrowserTabGroupColor,
  HronautApi
} from '../../../shared/types.js'
import { createWorkspaceOriginLoader } from './useWorkspaceOriginLoader.js'

type WorkspaceEditorBrowserApi = Pick<
  HronautApi,
  | 'getState'
  | 'createWorkspace'
  | 'updateTabGroup'
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
  const mode = ref<'create' | 'edit'>('edit')
  const workspaceId = ref<string | null>(null)
  const name = ref('')
  const color = ref<BrowserTabGroupColor>('purple')
  const error = ref('')
  const storageMode = ref<'scratch' | 'fork-default'>('scratch')
  const transferDirection = ref<'from-default' | 'to-default'>('from-default')
  const originOptions = ref<string[]>([])
  const selectedOrigins = ref<string[]>([])
  const storageState = ref<'idle' | 'loading' | 'saving' | 'saved' | 'error'>('idle')
  const storageMessage = ref('')
  const actionState = ref<'idle' | 'saving' | 'closing'>('idle')
  const originLoader = createWorkspaceOriginLoader((id) => options.browser.listWorkspaceStorageOrigins(id))
  let suppressDirectionReload = false
  let presentationGeneration = 0

  const workspace = computed(() => options.state.value.mcpTabGroups.find((candidate) => candidate.id === workspaceId.value))
  const isDefault = computed(() => workspace.value?.isDefault === true)
  const actionPending = computed(() => actionState.value !== 'idle')
  const saveDisabled = computed(() => (
    actionPending.value
    || !name.value.trim()
    || (mode.value === 'create'
      && storageMode.value === 'fork-default'
      && (storageState.value === 'loading' || storageState.value === 'error'))
  ))

  function beginPresentation(): number {
    presentationGeneration += 1
    originLoader.invalidate()
    actionState.value = 'idle'
    return presentationGeneration
  }

  function isPresentationCurrent(generation: number): boolean {
    return generation === presentationGeneration
  }

  function close(): void {
    beginPresentation()
    options.open.value = false
    workspaceId.value = null
    error.value = ''
    storageState.value = 'idle'
    storageMessage.value = ''
  }

  async function loadOrigins(browserState = options.state.value): Promise<void> {
    const defaultWorkspace = browserState.mcpTabGroups.find((candidate) => candidate.isDefault)
    const sourceId = mode.value === 'create' || transferDirection.value === 'from-default'
      ? defaultWorkspace?.id
      : workspaceId.value ?? undefined
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
    error.value = ''
    suppressDirectionReload = true
    transferDirection.value = 'from-default'
    suppressDirectionReload = false
    storageMessage.value = ''
    await loadOrigins(next)
  }

  async function openNew(): Promise<void> {
    if (!options.canPresent()) return
    beginPresentation()
    mode.value = 'create'
    options.open.value = true
    workspaceId.value = null
    name.value = options.translate('runtime.workspace.newName')
    color.value = 'purple'
    error.value = ''
    storageMode.value = 'scratch'
    suppressDirectionReload = true
    transferDirection.value = 'from-default'
    suppressDirectionReload = false
    storageMessage.value = ''
    await loadOrigins()
  }

  function transferOrigins(): string[] | undefined {
    const available = new Set(originOptions.value)
    const selected = [...new Set(selectedOrigins.value.filter((origin) => available.has(origin)))]
    return selected.length === available.size && selected.every((origin) => available.has(origin))
      ? undefined
      : selected
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
          ...(storageMode.value === 'fork-default' ? { origins: transferOrigins() } : {})
        }))
      } else if (currentWorkspaceId) {
        await options.syncState(options.browser.updateTabGroup(currentWorkspaceId, {
          name: name.value,
          color: color.value
        }))
      }
      if (!isPresentationCurrent(presentation)) return
      close()
    } catch (cause) {
      if (!isPresentationCurrent(presentation)) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      actionState.value = 'idle'
    }
  }

  async function transferStorage(): Promise<void> {
    if (!workspaceId.value || storageState.value === 'saving' || actionPending.value) return
    const presentation = presentationGeneration
    const currentWorkspaceId = workspaceId.value
    const currentDirection = transferDirection.value
    const currentOrigins = transferOrigins()
    storageState.value = 'saving'
    storageMessage.value = ''
    let result: Awaited<ReturnType<WorkspaceEditorBrowserApi['transferWorkspaceStorage']>>
    try {
      result = await options.browser.transferWorkspaceStorage({
        workspaceId: currentWorkspaceId,
        direction: currentDirection,
        origins: currentOrigins
      })
    } catch (cause) {
      if (!isPresentationCurrent(presentation)) return
      storageState.value = 'error'
      storageMessage.value = cause instanceof Error ? cause.message : String(cause)
      return
    }
    if (!isPresentationCurrent(presentation)) return
    const successMessage = options.translate('runtimeActions.workspace.copied', {
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
    storageState.value = 'saved'
    storageMessage.value = successMessage
  }

  async function closeWorkspace(): Promise<void> {
    const current = workspace.value
    if (!current || current.isDefault || actionPending.value || storageState.value === 'saving') return
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
      close()
    } catch (cause) {
      if (!isPresentationCurrent(presentation)) return
      error.value = cause instanceof Error ? cause.message : String(cause)
      actionState.value = 'idle'
    }
  }

  watch(transferDirection, () => {
    if (!suppressDirectionReload && options.open.value && mode.value === 'edit') void loadOrigins()
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
    transferDirection,
    originOptions,
    selectedOrigins,
    storageState,
    storageMessage,
    actionState,
    actionPending,
    saveDisabled,
    workspace,
    isDefault,
    openExisting,
    openNew,
    close,
    save,
    transferStorage,
    closeWorkspace,
    toggleAllOrigins,
    loadOrigins,
    dispose
  }
}
