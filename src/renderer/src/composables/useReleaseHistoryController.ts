import { computed, ref } from 'vue'
import type { AppReleaseHistoryEntry, HronautUpdatesApi } from '../../../shared/types.js'

type ReleaseHistoryOperation = 'initial' | 'refresh' | 'more'
type ReleaseHistoryState = 'idle' | 'loading' | 'ready' | 'error'

export interface ReleaseHistoryControllerOptions {
  api: Pick<HronautUpdatesApi, 'getReleaseHistory'>
  beforeOpen: () => void
  formatError: (error: unknown) => string
}

export function useReleaseHistoryController(options: ReleaseHistoryControllerOptions) {
  const open = ref(false)
  const releases = ref<AppReleaseHistoryEntry[]>([])
  const state = ref<ReleaseHistoryState>('idle')
  const error = ref('')
  const operation = ref<ReleaseHistoryOperation | null>(null)
  const page = ref(0)
  const hasMore = ref(false)
  let generation = 0
  let disposed = false

  const busy = computed(() => operation.value !== null)

  async function load(targetPage: number, nextOperation: ReleaseHistoryOperation): Promise<boolean> {
    if (disposed || operation.value) return false
    const currentGeneration = generation
    operation.value = nextOperation
    if (releases.value.length === 0 || nextOperation === 'refresh') state.value = 'loading'
    error.value = ''
    try {
      const result = await options.api.getReleaseHistory(targetPage, nextOperation === 'refresh')
      if (disposed || currentGeneration !== generation) return false
      if (nextOperation === 'more') {
        const known = new Set(releases.value.map((release) => release.url))
        releases.value = [...releases.value, ...result.releases.filter((release) => !known.has(release.url))]
      } else {
        releases.value = result.releases
      }
      page.value = result.page
      hasMore.value = result.hasMore
      state.value = 'ready'
      return true
    } catch (cause) {
      if (disposed || currentGeneration !== generation) return false
      error.value = options.formatError(cause)
      state.value = releases.value.length === 0 ? 'error' : 'ready'
      return false
    } finally {
      if (!disposed && currentGeneration === generation) operation.value = null
    }
  }

  function openDialog(): void {
    if (disposed) return
    options.beforeOpen()
    open.value = true
    if (state.value === 'idle' || (state.value === 'error' && releases.value.length === 0)) {
      void load(1, 'initial')
    }
  }

  function close(): void {
    if (!open.value) return
    generation += 1
    operation.value = null
    open.value = false
    state.value = releases.value.length === 0 ? 'idle' : 'ready'
  }

  function refresh(): Promise<boolean> {
    return load(1, 'refresh')
  }

  function loadMore(): Promise<boolean> {
    if (!hasMore.value) return Promise.resolve(false)
    return load(page.value + 1, 'more')
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
    operation.value = null
    open.value = false
  }

  return {
    open,
    releases,
    state,
    error,
    operation,
    page,
    hasMore,
    busy,
    openDialog,
    close,
    refresh,
    loadMore,
    dispose
  }
}

export type ReleaseHistoryController = ReturnType<typeof useReleaseHistoryController>
