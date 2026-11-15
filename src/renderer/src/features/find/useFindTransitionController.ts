import type { Ref } from 'vue'

export interface FindTransitionControllerOptions {
  findOpen: Readonly<Ref<boolean>>
  closeFind: () => Promise<void>
}

export function useFindTransitionController(options: FindTransitionControllerOptions) {
  async function start(operation: () => void | Promise<void>): Promise<void> {
    await operation()
  }

  async function run(action: () => void | Promise<void>): Promise<void> {
    const shouldCloseFind = options.findOpen.value
    const actionResult = start(action)
    const cleanupResult = shouldCloseFind ? start(options.closeFind) : undefined
    await Promise.all([actionResult, cleanupResult])
  }

  return { run }
}
