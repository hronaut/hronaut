export interface UiActionControllerOptions {
  onError: (error: unknown) => void
}

type UiAction = () => unknown

export function useUiActionController(options: UiActionControllerOptions) {
  let generation = 0
  let disposed = false

  async function run(action: UiAction): Promise<boolean> {
    if (disposed) return false
    const operationGeneration = generation
    try {
      await action()
      return !disposed && operationGeneration === generation
    } catch (error) {
      if (!disposed && operationGeneration === generation) options.onError(error)
      return false
    }
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    generation += 1
  }

  return {
    run,
    dispose
  }
}

export type UiActionController = ReturnType<typeof useUiActionController>
