import { computed, ref } from 'vue'
import type {
  HronautPermissionsApi,
  SitePermissionDecision,
  SitePermissionEntry,
  SitePermissionScope
} from '../../../shared/types.js'
import { sitePermissionName } from '../../../shared/site-permission-names.js'
import { sitePermissionKey, sitePermissionScopeOf } from '../../../shared/site-permission-scope.js'
import { friendlyUiError } from './useAppToastController.js'

type SitePermissionsApi = Pick<HronautPermissionsApi, 'set' | 'remove' | 'clear'>
type Translate = (key: string, parameters?: Record<string, unknown>) => string

/** An open or archived workspace a decision can belong to. */
export interface SitePermissionWorkspace {
  id: string
  name: string
  archived: boolean
}

export interface SitePermissionsControllerOptions {
  api: SitePermissionsApi
  translate: Translate
  /**
   * The open and archived workspaces, read whenever rows show them, or null until they have loaded, while a workspace
   * that is not listed may still be one of them.
   */
  workspaces: () => readonly SitePermissionWorkspace[] | null
  /** Whether websites may save to every single file they hold, read from the settings, and how to change it. */
  fileSaving: { enabled: () => boolean, set: (enabled: boolean) => Promise<unknown> }
  onError: (error: unknown) => void
}

/** The few last characters of a workspace's id, which tell apart workspaces that read alike. */
function shortWorkspaceId(workspaceId: string): string {
  return workspaceId.replaceAll('-', '').slice(-6)
}

const permissionKey = sitePermissionKey

function sortedEntries(entries: SitePermissionEntry[]): SitePermissionEntry[] {
  return [...entries].sort((left, right) => (
    left.origin.localeCompare(right.origin)
    || left.permission.localeCompare(right.permission)
    || (left.workspaceId ?? '').localeCompare(right.workspaceId ?? '')
    || (left.embeddedIn ?? '').localeCompare(right.embeddedIn ?? '')
  ))
}

/**
 * The scope the permissions bridge names a decision by: none for a decision saved before decisions belonged to a
 * workspace, so such a change or Forget is the same request it always was.
 */
function scopeArguments(entry: SitePermissionEntry): [] | [SitePermissionScope] {
  return entry.workspaceId === undefined ? [] : [sitePermissionScopeOf(entry)]
}

export function useSitePermissionsController(options: SitePermissionsControllerOptions) {
  const entries = ref<SitePermissionEntry[]>([])
  const pendingKeys = ref(new Set<string>())
  const clearing = ref(false)
  const errorMessage = ref('')
  const fileSavingPending = ref(false)
  const fileSavingEnabled = computed(() => options.fileSaving.enabled())
  let generation = 0
  let revision = 0
  let initializationGeneration = 0

  const groups = computed(() => {
    const grouped = new Map<string, SitePermissionEntry[]>()
    for (const entry of entries.value) {
      const permissions = grouped.get(entry.origin) ?? []
      permissions.push(entry)
      grouped.set(entry.origin, permissions)
    }
    return [...grouped].map(([origin, permissions]) => ({ origin, permissions }))
  })
  const busy = computed(() => clearing.value || fileSavingPending.value || pendingKeys.value.size > 0)

  function permissionLabel(permission: string): string {
    return sitePermissionName(permission, options.translate)
  }

  /**
   * Each known workspace's name as rows show it, which also says when it is archived. Two workspaces that would read
   * alike, such as one restored beside another of the same name, also show part of their id, so every row's controls
   * have a name of their own. Null until the workspaces have loaded.
   */
  const workspaceLabels = computed(() => {
    const workspaces = options.workspaces()
    if (!workspaces) return null
    const named = workspaces.map((workspace) => ({
      id: workspace.id,
      label: workspace.archived
        ? options.translate('settings.permissions.archivedWorkspace', { name: workspace.name })
        : workspace.name
    }))
    const counts = new Map<string, number>()
    for (const { label } of named) counts.set(label, (counts.get(label) ?? 0) + 1)
    return new Map(named.map(({ id, label }) => [id, counts.get(label)! > 1 ? `${label} · ${shortWorkspaceId(id)}` : label]))
  })

  /**
   * Where a decision applies, in words: its workspace's name, "All workspaces" for one saved before decisions belonged
   * to a workspace, a removed workspace with part of its id, and for a website embedded in another website's page, "on"
   * that website. Until the workspaces have loaded, a workspace is only said to be loading, never removed.
   */
  function scopeLabel(entry: SitePermissionEntry): string {
    const labels = workspaceLabels.value
    const workspace = entry.workspaceId === undefined
      ? options.translate('settings.permissions.allWorkspaces')
      : !labels
        ? options.translate('settings.permissions.loadingWorkspace')
        : labels.get(entry.workspaceId)
          ?? options.translate('settings.permissions.removedWorkspace', { id: shortWorkspaceId(entry.workspaceId) })
    return entry.embeddedIn
      ? `${workspace} · ${options.translate('settings.permissions.embeddedIn', { site: entry.embeddedIn })}`
      : workspace
  }

  function replace(next: SitePermissionEntry[]): void {
    revision += 1
    entries.value = sortedEntries(next.map((entry) => ({ ...entry })))
    errorMessage.value = ''
  }

  async function initialize(operation: Promise<SitePermissionEntry[]>): Promise<void> {
    const initialization = ++initializationGeneration
    const startingGeneration = generation
    const startingRevision = revision
    const next = await operation
    if (initialization !== initializationGeneration || startingGeneration !== generation || startingRevision !== revision) return
    replace(next)
  }

  function isPending(entry: SitePermissionEntry): boolean {
    return clearing.value || pendingKeys.value.has(permissionKey(entry))
  }

  function begin(entry: SitePermissionEntry): { generation: number, revision: number, key: string } | null {
    const key = permissionKey(entry)
    if (clearing.value || pendingKeys.value.has(key)) return null
    initializationGeneration += 1
    const nextPending = new Set(pendingKeys.value)
    nextPending.add(key)
    pendingKeys.value = nextPending
    errorMessage.value = ''
    return { generation, revision, key }
  }

  function finish(operation: { generation: number, key: string }): void {
    if (operation.generation !== generation) return
    const nextPending = new Set(pendingKeys.value)
    nextPending.delete(operation.key)
    pendingKeys.value = nextPending
  }

  function fail(operation: { generation: number }, error: unknown): false {
    if (operation.generation !== generation) return false
    errorMessage.value = friendlyUiError(error, options.translate('runtime.toast.settingKept'))
    options.onError(error)
    return false
  }

  async function setDecision(entry: SitePermissionEntry, decision: SitePermissionDecision): Promise<boolean> {
    const operation = begin(entry)
    if (!operation) return false
    try {
      const saved = await options.api.set(entry.origin, entry.permission, decision, ...scopeArguments(entry))
      if (operation.generation !== generation) return false
      if (operation.revision === revision) {
        entries.value = sortedEntries([
          ...entries.value.filter((candidate) => permissionKey(candidate) !== operation.key),
          { ...saved }
        ])
      }
      return true
    } catch (error) {
      return fail(operation, error)
    } finally {
      finish(operation)
    }
  }

  async function remove(entry: SitePermissionEntry): Promise<boolean> {
    const operation = begin(entry)
    if (!operation) return false
    try {
      await options.api.remove(entry.origin, entry.permission, ...scopeArguments(entry))
      if (operation.generation !== generation) return false
      if (operation.revision === revision) {
        entries.value = entries.value.filter((candidate) => permissionKey(candidate) !== operation.key)
      }
      return true
    } catch (error) {
      return fail(operation, error)
    } finally {
      finish(operation)
    }
  }

  /**
   * Resets the section: forgets every saved decision, and turns saving to every single file a website holds back off,
   * as it is by default. The switch goes first, so a reset never forgets the decisions and leaves the switch on. It is
   * turned off even when it reads off here, since this copy of the settings may not have heard of a change yet.
   */
  async function clear(): Promise<boolean> {
    if (busy.value) return false
    const operation = { generation, revision }
    initializationGeneration += 1
    clearing.value = true
    errorMessage.value = ''
    try {
      fileSavingPending.value = true
      try {
        await options.fileSaving.set(false)
      } finally {
        if (operation.generation === generation) fileSavingPending.value = false
      }
      if (operation.generation !== generation) return false
      await options.api.clear()
      if (operation.generation !== generation) return false
      if (operation.revision === revision) entries.value = []
      return true
    } catch (error) {
      return fail(operation, error)
    } finally {
      if (operation.generation === generation) clearing.value = false
    }
  }

  /** Turns saving to every single file a website holds on or off; false when it did not change, or the panel went away. */
  async function setFileSaving(enabled: boolean): Promise<boolean> {
    if (fileSavingPending.value || clearing.value) return false
    const operationGeneration = generation
    fileSavingPending.value = true
    try {
      await options.fileSaving.set(enabled)
      return operationGeneration === generation
    } catch (error) {
      if (operationGeneration === generation) options.onError(error)
      return false
    } finally {
      if (operationGeneration === generation) fileSavingPending.value = false
    }
  }

  function dispose(): void {
    generation += 1
    pendingKeys.value = new Set()
    clearing.value = false
    fileSavingPending.value = false
  }

  return {
    entries,
    groups,
    busy,
    clearing,
    errorMessage,
    permissionLabel,
    scopeLabel,
    permissionKey,
    initialize,
    replace,
    isPending,
    setDecision,
    remove,
    clear,
    fileSavingEnabled,
    fileSavingPending,
    setFileSaving,
    dispose
  }
}

export type SitePermissionsController = ReturnType<typeof useSitePermissionsController>
