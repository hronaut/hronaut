import {
  browserShortcutAction,
  type BrowserShortcutAction
} from '../../../shared/browser-shortcuts.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

export interface ShellKeyboardSurface {
  isOpen: () => boolean
  close: () => void
  toggleShortcut?: BrowserShortcutAction
}

export interface ShellKeyboardControllerOptions {
  allInteractionLocked: () => boolean
  commandPalette: ShellKeyboardSurface
  modalSurfaces: readonly ShellKeyboardSurface[]
  escapeSurfaces: readonly ShellKeyboardSurface[]
  runShortcut: (action: BrowserShortcutAction) => void
}

export function useShellKeyboardController(options: ShellKeyboardControllerOptions) {
  function guardInteraction(event: Event): void {
    if (
      !options.allInteractionLocked()
      || !(event.target instanceof Element)
      || event.target.closest('[data-lock-protected-tab-close]') === null
    ) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function closeFirst(surfaces: readonly ShellKeyboardSurface[]): boolean {
    const surface = surfaces.find((candidate) => candidate.isOpen())
    if (!surface) return false
    surface.close()
    return true
  }

  function handleKeyDown(event: KeyboardEvent): void {
    const composing = isImeCompositionEvent(event)
    const shortcut = browserShortcutAction({
      key: event.key,
      control: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      repeat: event.repeat,
      composing
    })
    guardInteraction(event)
    if (event.defaultPrevented || composing) return
    if (options.commandPalette.isOpen() && shortcut !== 'command-palette') {
      if (event.key === 'Escape') options.commandPalette.close()
      return
    }
    const activeModal = options.modalSurfaces.find((surface) => surface.isOpen())
    if (activeModal) {
      if (shortcut && shortcut === activeModal.toggleShortcut) {
        event.preventDefault()
        activeModal.close()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeFirst(options.modalSurfaces)
      }
      return
    }
    if (shortcut) {
      event.preventDefault()
      options.runShortcut(shortcut)
      return
    }
    if (event.key === 'Escape') closeFirst(options.escapeSurfaces)
  }

  return { guardInteraction, handleKeyDown }
}

export type ShellKeyboardController = ReturnType<typeof useShellKeyboardController>
