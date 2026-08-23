import { computed, ref } from 'vue'
import type {
  HronautPermissionsApi,
  SitePermissionDecision,
  SitePermissionEntry
} from '../../../shared/types.js'

type SitePermissionsApi = Pick<HronautPermissionsApi, 'set' | 'remove' | 'clear'>
type Translate = (key: string) => string

export interface SitePermissionsControllerOptions {
  api: SitePermissionsApi
  translate: Translate
  onError: (error: unknown) => void
}

function permissionKey(entry: Pick<SitePermissionEntry, 'origin' | 'permission'>): string {
  return `${entry.origin}\u0000${entry.permission}`
}

function sortedEntries(entries: SitePermissionEntry[]): SitePermissionEntry[] {
  return [...entries].sort((left, right) => (
    left.origin.localeCompare(right.origin)
    || left.permission.localeCompare(right.permission)
  ))
}

export function useSitePermissionsController(options: SitePermissionsControllerOptions) {
  const entries = ref<SitePermissionEntry[]>([])
  const pendingKeys = ref(new Set<string>())
  const clearing = ref(false)
  const errorMessage = ref('')
  let generation = 0
  let revision = 0

  const groups = computed(() => {
    const grouped = new Map<string, SitePermissionEntry[]>()
    for (const entry of entries.value) {
      const permissions = grouped.get(entry.origin) ?? []
      permissions.push(entry)
      grouped.set(entry.origin, permissions)
    }
    return [...grouped].map(([origin, permissions]) => ({ origin, permissions }))
  })
  const busy = computed(() => clearing.value || pendingKeys.value.size > 0)

  function permissionLabel(permission: string): string {
    const labels: Record<string, string> = {
      'clipboard-read': options.translate('runtime.permissions.clipboardRead'),
      'clipboard-sanitized-write': options.translate('runtime.permissions.clipboardWrite'),
      'display-capture': options.translate('runtime.permissions.display'),
      fileSystem: options.translate('runtime.permissions.files'),
      fullscreen: options.translate('runtime.permissions.fullscreen'),
      geolocation: options.translate('runtime.permissions.location'),
      'idle-detection': options.translate('runtime.permissions.activity'),
      media: options.translate('runtime.permissions.media'),
      notifications: options.translate('runtime.permissions.notifications'),
      'storage-access': options.translate('runtime.permissions.storage'),
      'top-level-storage-access': options.translate('runtime.permissions.relatedStorage'),
      'window-management': options.translate('runtime.permissions.windows')
    }
    return labels[permission] ?? permission.replaceAll('-', ' ')
  }

  function replace(next: SitePermissionEntry[]): void {
    revision += 1
    entries.value = sortedEntries(next.map((entry) => ({ ...entry })))
    errorMessage.value = ''
  }

  async function initialize(operation: Promise<SitePermissionEntry[]>): Promise<void> {
    const startingGeneration = generation
    const startingRevision = revision
    const next = await operation
    if (startingGeneration !== generation || startingRevision !== revision) return
    replace(next)
  }

  function isPending(entry: SitePermissionEntry): boolean {
    return clearing.value || pendingKeys.value.has(permissionKey(entry))
  }

  function begin(entry: SitePermissionEntry): { generation: number, revision: number, key: string } | null {
    const key = permissionKey(entry)
    if (clearing.value || pendingKeys.value.has(key)) return null
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
    errorMessage.value = error instanceof Error ? error.message : String(error)
    options.onError(error)
    return false
  }

  async function setDecision(entry: SitePermissionEntry, decision: SitePermissionDecision): Promise<boolean> {
    const operation = begin(entry)
    if (!operation) return false
    try {
      const saved = await options.api.set(entry.origin, entry.permission, decision)
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
      await options.api.remove(entry.origin, entry.permission)
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

  async function clear(): Promise<boolean> {
    if (busy.value) return false
    const operation = { generation, revision }
    clearing.value = true
    errorMessage.value = ''
    try {
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

  function dispose(): void {
    generation += 1
    pendingKeys.value = new Set()
    clearing.value = false
  }

  return {
    entries,
    groups,
    busy,
    clearing,
    errorMessage,
    permissionLabel,
    initialize,
    replace,
    isPending,
    setDecision,
    remove,
    clear,
    dispose
  }
}

export type SitePermissionsController = ReturnType<typeof useSitePermissionsController>
