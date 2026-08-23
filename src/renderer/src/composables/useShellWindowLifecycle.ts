import type { Ref } from 'vue'
import { useEventListener, useResizeObserver } from '@vueuse/core'

export interface ShellWindowLifecycleOptions {
  shell: Ref<HTMLElement | null>
  onKeyDown: (event: KeyboardEvent) => void
  onWindowResize: () => void
  onShellResize: () => void
}

export function useShellWindowLifecycle(options: ShellWindowLifecycleOptions): void {
  useEventListener(window, 'keydown', options.onKeyDown)
  useEventListener(window, 'resize', options.onWindowResize)
  useResizeObserver(options.shell, options.onShellResize)
}
