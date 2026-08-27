import { onBeforeUnmount, onMounted } from 'vue'
import {
  useShellWindowLifecycle,
  type ShellWindowLifecycleOptions
} from './useShellWindowLifecycle.js'

export interface AppLifecycleControllerOptions extends ShellWindowLifecycleOptions {
  start: () => void
  disposers: readonly (() => void)[]
}

export interface AppLifecycleController {
  dispose: () => void
}

export function useAppLifecycleController(
  options: AppLifecycleControllerOptions
): AppLifecycleController {
  const disposers = [...new Set(options.disposers)]
  let disposed = false

  useShellWindowLifecycle(options)
  onMounted(options.start)

  function dispose(): void {
    if (disposed) return
    disposed = true
    for (const disposer of disposers) disposer()
  }

  onBeforeUnmount(dispose)

  return { dispose }
}
