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
      code: event.code,
      control: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      repeat: event.repeat,
      composing,
      mac: window.hronautShell?.windowChrome.platform === 'darwin'
    })
    guardInteraction(event)
    if (event.defaultPrevented || composing) return
    // A held Escape repeats. Only its first press closes anything, so holding it after closing one surface, such as
    // Find, does not close the next one too, such as a panel in its own window.
    const escape = event.key === 'Escape' && !event.repeat
    // Its own two shortcuts reach the open palette: each closes its list or turns to the other one.
    if (options.commandPalette.isOpen() && shortcut !== 'command-palette' && shortcut !== 'switch-workspace') {
      if (escape) options.commandPalette.close()
      return
    }
    const activeModal = options.modalSurfaces.find((surface) => surface.isOpen())
    if (activeModal) {
      if (shortcut && shortcut === activeModal.toggleShortcut) {
        event.preventDefault()
        activeModal.close()
        return
      }
      if (escape) {
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
    if (escape) closeFirst(options.escapeSurfaces)
  }

  return { guardInteraction, handleKeyDown }
}

export type ShellKeyboardController = ReturnType<typeof useShellKeyboardController>
