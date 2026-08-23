import { ref } from 'vue'

export interface AppBootstrapTask {
  id: string
  run: () => unknown
}

export interface AppBootstrapFailure {
  id: string
  error: unknown
}

export interface AppBootstrapControllerOptions {
  tasks: AppBootstrapTask[]
  onFailure: (failures: AppBootstrapFailure[]) => void
}

export function useAppBootstrapController(options: AppBootstrapControllerOptions) {
  const taskIds = new Set(options.tasks.map((task) => task.id))
  if (taskIds.size !== options.tasks.length) throw new Error('App bootstrap task ids must be unique')

  const running = ref(false)
  const ready = ref(options.tasks.length === 0)
  const failures = ref<AppBootstrapFailure[]>([])
  const pendingTaskIds = new Set(taskIds)
  let generation = 0
  let disposed = false
  let initializePromise: Promise<boolean> | null = null

  function runTask(task: AppBootstrapTask): Promise<unknown> {
    try {
      return Promise.resolve(task.run())
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  function initialize(): Promise<boolean> {
    if (disposed) return Promise.resolve(false)
    if (ready.value) return Promise.resolve(true)
    if (initializePromise) return initializePromise
    const currentGeneration = generation
    const tasks = options.tasks.filter((task) => pendingTaskIds.has(task.id))
    running.value = true
    initializePromise = Promise.allSettled(tasks.map(runTask))
      .then((results) => {
        if (disposed || currentGeneration !== generation) return false
        const nextFailures: AppBootstrapFailure[] = []
        for (const [index, result] of results.entries()) {
          const task = tasks[index]
          if (!task) continue
          if (result.status === 'fulfilled') pendingTaskIds.delete(task.id)
          else {
            pendingTaskIds.add(task.id)
            nextFailures.push({ id: task.id, error: result.reason })
          }
        }
        failures.value = nextFailures
        ready.value = pendingTaskIds.size === 0
        if (nextFailures.length) options.onFailure(nextFailures)
        return ready.value
      })
      .finally(() => {
        if (!disposed && currentGeneration === generation) {
          initializePromise = null
          running.value = false
        }
      })
    return initializePromise
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
    initializePromise = null
    running.value = false
    ready.value = false
    failures.value = []
    pendingTaskIds.clear()
  }

  return {
    running,
    ready,
    failures,
    initialize,
    dispose
  }
}

export type AppBootstrapController = ReturnType<typeof useAppBootstrapController>
