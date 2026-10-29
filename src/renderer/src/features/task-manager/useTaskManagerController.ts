import { ref } from 'vue'
import type { HronautTaskManagerApi, TaskManagerProcess } from '../../../../shared/types.js'

type TaskManagerState = 'loading' | 'ready' | 'error'

/** How often the open Task manager reads the processes again, as Chrome's does every second. */
export const TASK_MANAGER_REFRESH_MS = 1000

export interface TaskManagerControllerOptions {
  api: Pick<HronautTaskManagerApi, 'list' | 'endProcess'>
  /** Closes what the dialog would cover or fight for focus, such as the command palette or another dialog. */
  beforeOpen: () => void
  formatError: (error: unknown) => string
  refreshMs?: number
}

/**
 * The Task manager dialog, as Chrome's: while open it reads Hronaut's processes every second, and End process ends a
 * page process the list lets end. A reading that finishes after the dialog closed, or after a newer one, changes
 * nothing.
 */
export function useTaskManagerController(options: TaskManagerControllerOptions) {
  const open = ref(false)
  const processes = ref<TaskManagerProcess[]>([])
  const state = ref<TaskManagerState>('loading')
  const error = ref('')
  /** The process End process is ending, until main answers. */
  const ending = ref<number | null>(null)
  const refreshMs = options.refreshMs ?? TASK_MANAGER_REFRESH_MS
  let generation = 0
  let reading = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function stopTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  async function refresh(): Promise<void> {
    if (disposed || !open.value) return
    const openGeneration = generation
    const currentReading = ++reading
    try {
      const list = await options.api.list()
      if (disposed || openGeneration !== generation || currentReading !== reading) return
      processes.value = list
      state.value = 'ready'
      error.value = ''
    } catch (cause) {
      if (disposed || openGeneration !== generation || currentReading !== reading) return
      error.value = options.formatError(cause)
      if (processes.value.length === 0) state.value = 'error'
    }
  }

  function scheduleRefresh(openGeneration: number): void {
    stopTimer()
    timer = setTimeout(() => {
      timer = undefined
      if (disposed || openGeneration !== generation) return
      void refresh().finally(() => {
        if (!disposed && open.value && openGeneration === generation) scheduleRefresh(openGeneration)
      })
    }, refreshMs)
  }

  function openDialog(): void {
    if (disposed || open.value) return
    options.beforeOpen()
    const openGeneration = ++generation
    processes.value = []
    state.value = 'loading'
    error.value = ''
    ending.value = null
    open.value = true
    void refresh().finally(() => {
      if (!disposed && open.value && openGeneration === generation) scheduleRefresh(openGeneration)
    })
  }

  function close(): void {
    if (!open.value) return
    generation += 1
    stopTimer()
    ending.value = null
    open.value = false
  }

  function toggle(): void {
    if (open.value) close()
    else openDialog()
  }

  /** Ends the process, then reads the list again so it leaves at once rather than at the next reading. */
  async function endProcess(pid: number): Promise<void> {
    if (disposed || !open.value || ending.value !== null) return
    const openGeneration = generation
    ending.value = pid
    try {
      await options.api.endProcess(pid)
      if (disposed || openGeneration !== generation) return
      error.value = ''
      await refresh()
    } catch (cause) {
      if (disposed || openGeneration !== generation) return
      error.value = options.formatError(cause)
    } finally {
      if (!disposed && openGeneration === generation && ending.value === pid) ending.value = null
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
    stopTimer()
    open.value = false
  }

  return { open, processes, state, error, ending, openDialog, close, toggle, refresh, endProcess, dispose }
}

export type TaskManagerController = ReturnType<typeof useTaskManagerController>
