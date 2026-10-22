/**
 * What Enter with modifier keys does in the address field, by the rules of Chrome's address bar:
 * - Ctrl+Enter adds "www." and ".com" to a site name and opens it in the current tab;
 * - Alt+Enter (Option+Return on a Mac) opens the address in a new tab, and Alt+Shift+Enter in a new background tab;
 * - on a Mac, ⌘+Return opens it in a new background tab, and ⌘+Shift+Return in a new tab.
 * Chrome's Shift+Enter opens a new window, which Hronaut has not. Plain Enter, and any other combination, does what it
 * did before.
 */
export type AddressEnterAction = 'add-www-and-com' | 'new-tab' | 'new-background-tab'

export function addressEnterAction(event: KeyboardEvent, mac: boolean): AddressEnterAction | undefined {
  if (event.key !== 'Enter') return undefined
  const { ctrlKey: ctrl, altKey: alt, shiftKey: shift, metaKey: meta } = event
  // Ctrl with Alt is AltGr on Windows, and the Windows or Super key belongs to the system.
  if (ctrl) return !alt && !shift && !meta ? 'add-www-and-com' : undefined
  if (meta && !mac) return undefined
  if ((alt && !shift) || (shift && meta)) return 'new-tab'
  if (alt || meta) return 'new-background-tab'
  return undefined
}

const SITE_NAME = /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]*[\p{L}\p{M}\p{N}])?$/u

/**
 * "example" becomes "www.example.com", "www.example" too, and "example/news" becomes "www.example.com/news". Text
 * that is not a bare site name (a search, an address with a scheme, a port, a sign-in or a dot) gets undefined, and
 * opens as typed.
 */
export function withWwwAndCom(text: string): string | undefined {
  const typed = text.trim()
  if (!typed || /[\s@:]/u.test(typed)) return undefined
  const restAt = typed.search(/[/?#]/u)
  const host = restAt < 0 ? typed : typed.slice(0, restAt)
  const rest = restAt < 0 ? '' : typed.slice(restAt)
  const name = /^www\./iu.test(host) ? host.slice(4) : host
  if (!SITE_NAME.test(name)) return undefined
  return `www.${name}.com${rest}`
}
