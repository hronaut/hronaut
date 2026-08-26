export type BrowserShortcutAction =
  | 'focus-address'
  | 'new-tab'
  | 'close-tab'
  | 'reopen-closed-tab'
  | 'next-tab'
  | 'previous-tab'
  | `select-tab-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | 'select-last-tab'
  | 'find'
  | 'reload'
  | 'reload-ignoring-cache'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-reset'
  | 'bookmark'
  | 'visit-history'
  | 'search-tabs'
  | 'clear-browsing-data'
  | 'command-palette'
  | 'pick-element'
  | 'toggle-devtools'

export interface BrowserShortcutInput {
  key: string
  control: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  repeat?: boolean
  composing?: boolean
}

export function browserShortcutAction(input: BrowserShortcutInput): BrowserShortcutAction | null {
  const key = input.key.toLowerCase()
  if (input.repeat || input.composing) return null
  if (
    (key === 'f12' && !input.control && !input.meta && !input.alt && !input.shift)
    || (key === 'i' && input.control && input.shift && !input.meta && !input.alt)
    || (key === 'i' && input.meta && input.alt && !input.control && !input.shift)
  ) return 'toggle-devtools'
  if (
    (key === 'c' && input.control && input.shift && !input.meta && !input.alt)
    || (key === 'c' && input.meta && input.alt && !input.control && !input.shift)
  ) return 'pick-element'
  if (input.alt) return null

  if (input.control && key === 'tab') return input.shift ? 'previous-tab' : 'next-tab'
  if (!input.shift && ((input.control && key === 'h') || (input.meta && key === 'y'))) return 'visit-history'
  if (!input.control && !input.meta) return null
  if (!input.shift && /^[1-8]$/.test(key)) return `select-tab-${key}` as BrowserShortcutAction
  if (!input.shift && key === '9') return 'select-last-tab'
  if (input.shift && (key === 'delete' || key === 'backspace')) return 'clear-browsing-data'
  if (input.shift && key === 'p') return 'command-palette'
  if (input.shift && key === 'a') return 'search-tabs'
  if (key === 'r') return input.shift ? 'reload-ignoring-cache' : 'reload'

  if (key === '+' || key === '=') return 'zoom-in'
  if (!input.shift && key === '-') return 'zoom-out'
  if (!input.shift && key === '0') return 'zoom-reset'
  if (key === 't') return input.shift ? 'reopen-closed-tab' : 'new-tab'
  if (input.shift) return null
  if (key === 'l') return 'focus-address'
  if (key === 'w') return 'close-tab'
  if (key === 'f') return 'find'
  if (key === 'd') return 'bookmark'
  return null
}
