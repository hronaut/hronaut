import { computed, ref } from 'vue'
import type {
  HronautCredentialsApi,
  CredentialStorageStatus,
  CredentialSummary
} from '../../../shared/types.js'

type CredentialsApi = Pick<HronautCredentialsApi, 'importFromCsv' | 'remove'>

export interface CredentialsControllerOptions {
  api: CredentialsApi
  initializingReason: string
  missingCredentialMessage: string
  formatError: (error: unknown) => string
  onRemoved: () => void
  onError: (error: unknown) => void
}

function sortedCredentials(credentials: CredentialSummary[]): CredentialSummary[] {
  return [...credentials].sort((left, right) => (
    left.origin.localeCompare(right.origin)
    || left.username.localeCompare(right.username)
    || left.id.localeCompare(right.id)
  ))
}

export function useCredentialsController(options: CredentialsControllerOptions) {
  const entries = ref<CredentialSummary[]>([])
  const storage = ref<CredentialStorageStatus>({
    available: false,
    reason: options.initializingReason
  })
  const pendingIds = ref(new Set<string>())
  const errorMessage = ref('')
  let generation = 0
  let revision = 0

  const busy = computed(() => pendingIds.value.size > 0)

  function replace(next: CredentialSummary[]): void {
    revision += 1
    entries.value = sortedCredentials(next.map((entry) => ({ ...entry })))
    errorMessage.value = ''
  }

  async function initialize(
    statusOperation: Promise<CredentialStorageStatus>,
    entriesOperation: Promise<CredentialSummary[]>
  ): Promise<void> {
    const startingGeneration = generation
    const startingRevision = revision
    const [nextStorage, nextEntries] = await Promise.all([statusOperation, entriesOperation])
    if (startingGeneration !== generation) return
    storage.value = { ...nextStorage }
    if (startingRevision === revision) replace(nextEntries)
  }

  function isPending(id: string): boolean {
    return pendingIds.value.has(id)
  }

  async function remove(id: string): Promise<boolean> {
    if (pendingIds.value.has(id)) return false
    const operation = { generation, revision, id }
    pendingIds.value = new Set([...pendingIds.value, id])
    errorMessage.value = ''
    try {
      const removed = await options.api.remove(id)
      if (!removed) throw new Error(options.missingCredentialMessage)
      if (operation.generation !== generation) return false
      if (operation.revision === revision) {
        entries.value = entries.value.filter((entry) => entry.id !== id)
      }
      options.onRemoved()
      return true
    } catch (error) {
      if (operation.generation !== generation) return false
      errorMessage.value = options.formatError(error)
      options.onError(error)
      return false
    } finally {
      if (operation.generation === generation) {
        const nextPending = new Set(pendingIds.value)
        nextPending.delete(id)
        pendingIds.value = nextPending
      }
    }
  }

  function dispose(): void {
    generation += 1
    pendingIds.value = new Set()
  }

  return {
    entries,
    storage,
    busy,
    errorMessage,
    importFromCsv: options.api.importFromCsv,
    initialize,
    replace,
    isPending,
    remove,
    dispose
  }
}

export type CredentialsController = ReturnType<typeof useCredentialsController>
