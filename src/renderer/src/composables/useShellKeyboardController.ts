import {
  browserShortcutAction,
  isBrowserKey,
  websiteKeptShortcutAction,
  type BrowserShortcutAction,
  type BrowserShortcutInput
} from '../../../shared/browser-shortcuts.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'

export interface ShellKeyboardSurface {
  isOpen: () => boolean
  close: () => void
  toggleShortcut?: BrowserShortcutAction
  /** True while the surface is shown in a window of its own, beside the one that has the keyboard. */
  inOwnWindow?: () => boolean
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

  // Escape closes what is open in this window first, such as Downloads, and a panel in its own window only after it.
  function closeNearest(surfaces: readonly ShellKeyboardSurface[]): void {
    const surface = surfaces.find((candidate) => candidate.isOpen() && !candidate.inOwnWindow?.())
      ?? surfaces.find((candidate) => candidate.isOpen())
    surface?.close()
  }

  function handleKeyDown(event: KeyboardEvent): void {
    const composing = isImeCompositionEvent(event)
    const input: BrowserShortcutInput = {
      key: event.key,
      code: event.code,
      control: event.ctrlKey,
      meta: event.metaKey,
      alt: event.altKey,
      shift: event.shiftKey,
      repeat: event.repeat,
      composing,
      mac: window.hronautShell?.windowChrome.platform === 'darwin'
    }
    // Hronaut's own window has no website to keep F5, Alt+D, F3, Ctrl+G or F6.
    const shortcut = browserShortcutAction(input) ?? websiteKeptShortcutAction(input)
    // A browser key left alone goes on to the application menu, which acts on the page in view. Under the palette or a
    // dialog that page is behind them, so there the key goes nowhere.
    const browserKey = isBrowserKey(input)
    guardInteraction(event)
    if (event.defaultPrevented || composing) return
    // A held Escape repeats. Only its first press closes anything, so holding it after closing one surface, such as
    // Find, does not close the next one too, such as a panel in its own window.
    const escape = event.key === 'Escape' && !event.repeat
    // Its own two shortcuts reach the open palette: each closes its list or turns to the other one.
    if (options.commandPalette.isOpen() && shortcut !== 'command-palette' && shortcut !== 'switch-workspace') {
      if (escape) options.commandPalette.close()
      else if (browserKey) event.preventDefault()
      return
    }
    const activeModal = options.modalSurfaces.find((surface) => surface.isOpen())
    if (activeModal) {
      if (shortcut && shortcut === activeModal.toggleShortcut) {
        event.preventDefault()
        activeModal.close()
        return
      }
      // The open modal takes every Escape, so a repeat cannot reach a field under it, such as Tab search's query.
      if (event.key === 'Escape') {
        event.preventDefault()
        if (escape) closeFirst(options.modalSurfaces)
      } else if (browserKey) event.preventDefault()
      return
    }
    if (shortcut) {
      event.preventDefault()
      options.runShortcut(shortcut)
      return
    }
    if (escape) closeNearest(options.escapeSurfaces)
  }

  return { guardInteraction, handleKeyDown }
}

export type ShellKeyboardController = ReturnType<typeof useShellKeyboardController>
