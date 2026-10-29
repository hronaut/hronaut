import type { TrustedChromeFocusAccess, TrustedChromeFocusTab } from './trusted-chrome-focus-access.js'

/**
 * Trusted chrome keeps the page under it while its exit plays, so a page
 * focused then would take keys typed into the shell. The page takes focus
 * when trusted chrome closes instead, unless the human clicks or presses a
 * key in the shell first. The repeats of a key still held from closing it,
 * such as Enter on a dialog's button, are not a new key.
 */
function focusTabAfterTrustedChrome<Tab extends TrustedChromeFocusTab>(access: TrustedChromeFocusAccess<Tab>, tab: Tab): void {
  const pending = access.focusAfterTrustedChrome()
  if (pending && !pending.tab) return
  cancelFocusAfterTrustedChrome(access)
  const shell = access.window().webContents
  const onInput = (_event: Electron.Event, input: Electron.InputEvent): void => {
    const newKey = (input.type === 'rawKeyDown' || input.type === 'keyDown')
      && !input.modifiers?.some((modifier) => modifier.toLowerCase() === 'isautorepeat')
    if (input.type === 'mouseDown' || newKey) cancelFocusAfterTrustedChrome(access)
  }
  shell.on('input-event', onInput)
  access.setFocusAfterTrustedChrome({
    tab,
    cancel: () => {
      if (!shell.isDestroyed()) shell.removeListener('input-event', onInput)
    }
  })
}

/**
 * Keeps every page from the keyboard until trusted chrome closes, even one that was to take it then or asks for it
 * meanwhile, such as the tab selected after another closes; a page receiving agent input still takes it. Nothing waits
 * to take the keyboard once trusted chrome is gone.
 */
export function withholdFocusAfterTrustedChrome<Tab extends TrustedChromeFocusTab>(access: TrustedChromeFocusAccess<Tab>): void {
  if (!access.browserContentOccluded()) return
  cancelFocusAfterTrustedChrome(access)
  access.setFocusAfterTrustedChrome({ cancel: () => undefined })
}

/** Stops waiting to focus a page after trusted chrome, returning the tab that waited. */
export function cancelFocusAfterTrustedChrome<Tab extends TrustedChromeFocusTab>(access: TrustedChromeFocusAccess<Tab>): Tab | undefined {
  const pending = access.focusAfterTrustedChrome()
  access.setFocusAfterTrustedChrome(undefined)
  pending?.cancel()
  return pending?.tab
}

/**
 * Gives keyboard focus to the tab's page in the focused window, or to the
 * shell while the person's input to the page is locked. While trusted chrome
 * covers the pages, the page takes focus once it closes. A page receiving
 * agent input takes focus regardless.
 */
export function focusTabOrTrustedChrome<Tab extends TrustedChromeFocusTab>(access: TrustedChromeFocusAccess<Tab>, tab: Tab): void {
  // Tab creation, replacement and renderer recovery also run in the
  // background. Only transfer keyboard focus inside an already active shell.
  if (access.window().isDestroyed() || !access.window().isFocused()) return
  if (access.isHumanInteractionLocked(tab) && !access.agentInputWebContents().has(tab.webContents.id)) {
    access.window().webContents.focus()
    return
  }
  if (access.browserContentOccluded() && !access.agentInputWebContents().has(tab.webContents.id)) {
    focusTabAfterTrustedChrome(access, tab)
    return
  }
  tab.webContents.focus()
}
