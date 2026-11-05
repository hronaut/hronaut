import type { Input, KeyboardInputEvent, WebContents } from 'electron'
import type { BrowserShortcutAction } from '../../shared/browser-shortcuts.js'
import { SHELL_IPC } from '../../shared/ipc/shell.js'
import { sendTo } from '../typed-ipc.js'

/** How long the shell's keys wait at most for it to run a shortcut, should it not say that it has, as while it reloads. */
const SHORTCUT_KEYS_WAIT_MS = 1000

/**
 * Keys the shell held back while it runs shortcuts main sent it, the shortcuts it has still to run, and until when;
 * whether the last key down that reached it was held back, and whether main is sending it keys itself.
 */
interface ShellKeyHandoff {
  holds: Set<number>
  until: number
  keys: Input[]
  timer: ReturnType<typeof setTimeout> | undefined
  lastKeyDownHeld: boolean
  sending: 'keys' | 'closing' | undefined
}

const handoffs = new WeakMap<WebContents, ShellKeyHandoff>()
let lastHold = 0

/** The shortcuts that put the shell's keyboard somewhere the keys typed next go: a field, or a dialog's. */
const SHORTCUTS_THAT_TAKE_KEYS: ReadonlySet<BrowserShortcutAction> = new Set<BrowserShortcutAction>([
  'focus-address', 'find', 'find-next', 'find-previous', 'bookmark-all-tabs', 'command-palette'
])

/** Lets the main window's shell hold back the keys typed while it runs a shortcut main sent it. */
export function attachShellKeyHandoff(shell: WebContents): void {
  const handoff: ShellKeyHandoff = { holds: new Set(), until: 0, keys: [], timer: undefined, lastKeyDownHeld: false, sending: undefined }
  handoffs.set(shell, handoff)
  shell.on('before-input-event', (event, input) => {
    // The keys main sends on go to the shell, and the key down that closes them stops there (see releaseShellKeys).
    if (handoff.sending) {
      if (handoff.sending === 'closing') event.preventDefault()
      return
    }
    if (input.type === 'keyDown') handoff.lastKeyDownHeld = false
    if (handoff.holds.size === 0 || event.defaultPrevented || !heldBack(input)) return
    const wait = handoff.until - performance.now()
    // The shell did not say in time that it ran them, as while it reloads: its keys go on as they come.
    if (wait <= 0 && handoff.keys.length === 0) {
      handoff.holds.clear()
      return
    }
    event.preventDefault()
    handoff.lastKeyDownHeld = true
    handoff.keys.push(input)
    // Keys held past the wait, should its timer be late, go on after this one, never from inside the key's handling.
    if (wait <= 0) restartTimer(shell, handoff, 0)
    else if (handoff.timer === undefined) restartTimer(shell, handoff, wait)
  })
}

/**
 * Asks the shell to run a shortcut. For one that gives a field or a dialog the keyboard, the keys typed into the shell
 * from now on wait until it says that the keyboard is there, or that it ran the shortcut, and then go on in order.
 * Main gives the shell the keyboard before it sends the shortcut, and a busy shell handles keys before messages: typed
 * right after Ctrl/Cmd+L, they went to where the shell had the keyboard before, such as after the address's text,
 * which the address field then selected. Chrome runs its keys in order. A key the shell passes on at once, such as a
 * modifier alone or a Cmd shortcut that macOS's menu takes first, is not held.
 */
export function requestShellShortcut(shell: WebContents, action: BrowserShortcutAction): void {
  const hold = SHORTCUTS_THAT_TAKE_KEYS.has(action) ? holdShellKeys(shell) : undefined
  if (hold === undefined) sendTo(shell, SHELL_IPC.shortcutRequested, action)
  else sendTo(shell, SHELL_IPC.shortcutRequested, action, hold)
}

/** Starts holding the shell's keys for a shortcut, and names the hold the shell's answer ends. */
function holdShellKeys(shell: WebContents): number | undefined {
  const handoff = handoffs.get(shell)
  if (!handoff || shell.isDestroyed()) return undefined
  // Holds the shell never answered in time, as before it reloaded, end with the wait; a late answer ends nothing.
  if (handoff.until <= performance.now()) handoff.holds.clear()
  lastHold += 1
  handoff.holds.add(lastHold)
  handoff.until = performance.now() + SHORTCUT_KEYS_WAIT_MS
  if (handoff.timer !== undefined) restartTimer(shell, handoff, SHORTCUT_KEYS_WAIT_MS)
  return lastHold
}

/** The shell has the keyboard where the shortcut put it, or ran it; once no shortcut is left, its keys go on. */
export function shellRanShortcut(shell: WebContents, hold: number): void {
  const handoff = handoffs.get(shell)
  if (!handoff?.holds.delete(hold) || handoff.holds.size > 0) return
  releaseShellKeys(shell, handoff)
}

/**
 * A key typed that can be sent again: not a modifier alone, a Cmd shortcut, a key an input method takes, such as a
 * dead key or one it composes with, or a key with no place on a US keyboard, such as a media key or the Hungarian í.
 */
function heldBack(input: Input): boolean {
  return input.type === 'keyDown' && !input.meta && !input.isComposing && !PASSED_KEYS.has(input.key) && keyEventsOf(input).length > 0
}

function restartTimer(shell: WebContents, handoff: ShellKeyHandoff, wait: number): void {
  clearTimeout(handoff.timer)
  handoff.timer = setTimeout(() => releaseShellKeys(shell, handoff), wait)
}

/**
 * Sends the held keys on in order. Chromium drops what follows a key down held back, its text and its release, until
 * the next key down, and a key sent on is one: a held key's own text still on its way, as on Windows, where it comes a
 * moment after its key down, would then type it a second time. So when the last key down was held, the keys end with a
 * key down main holds back itself, which starts dropping them again until the next key typed.
 */
function releaseShellKeys(shell: WebContents, handoff: ShellKeyHandoff): void {
  clearTimeout(handoff.timer)
  handoff.timer = undefined
  handoff.holds.clear()
  const keys = handoff.keys.splice(0)
  if (shell.isDestroyed() || keys.length === 0) return
  const closing = handoff.lastKeyDownHeld
  try {
    handoff.sending = 'keys'
    for (const input of keys) {
      for (const event of keyEventsOf(input)) shell.sendInputEvent(event)
    }
    handoff.sending = 'closing'
    if (closing) shell.sendInputEvent({ type: 'keyDown', keyCode: 'F24' })
  } finally {
    handoff.sending = undefined
  }
}

/**
 * The key again as the keyboard sends it, and the text it typed: a held key's own text and release never reached the
 * shell. The key goes by what it types when that is a digit of the number row or an ASCII character, as browser keys
 * are taken (see shortcutKey), so AZERTY's A stays Ctrl+A rather than Ctrl+Q; a letter of another script goes by its
 * place on a US keyboard. A key with neither cannot be sent again: its text alone would be dropped.
 */
export function keyEventsOf(input: Input, platform: NodeJS.Platform = process.platform): KeyboardInputEvent[] {
  const modifiers: NonNullable<KeyboardInputEvent['modifiers']> = []
  if (input.shift) modifiers.push('shift')
  if (input.control) modifiers.push('control')
  if (input.alt) modifiers.push('alt')
  if (input.meta) modifiers.push('meta')
  if (input.isAutoRepeat) modifiers.push('isautorepeat')
  if (input.code.startsWith('Numpad')) modifiers.push('iskeypad')
  const keyCode = keyCodeOf(input)
  const text = typedText(input, platform)
  if (!keyCode) return []
  return [
    { type: 'keyDown', keyCode, modifiers },
    ...text ? [{ type: 'char' as const, keyCode: text, modifiers }] : [],
    { type: 'keyUp', keyCode, modifiers }
  ]
}

/**
 * The text a key typed, as Chromium sends it after the key: a character, or Enter's, which submits a form such as the
 * address's. A Ctrl, Cmd or Alt shortcut types none, but Option types characters on macOS, and so does AltGr, which
 * Windows reports as Ctrl+Alt: there a plain letter or digit is a Ctrl+Alt shortcut instead.
 */
function typedText(input: Input, platform: NodeJS.Platform): string | undefined {
  if (input.meta) return undefined
  if (input.code === 'Enter' || input.code === 'NumpadEnter') return input.control || input.alt ? undefined : '\r'
  if ([...input.key].length !== 1) return undefined
  if (input.control && input.alt) return platform === 'win32' && !/^[a-z0-9]$/i.test(input.key) ? input.key : undefined
  if (input.control || (input.alt && platform !== 'darwin')) return undefined
  return input.key
}

function keyCodeOf(input: Input): string | undefined {
  const digit = /^Digit(\d)$/.exec(input.code)?.[1]
  if (digit) return digit
  // A key of the keypad types its digit with Num Lock on, and moves the caret as the key it names with it off.
  if (/^Numpad\d$/.test(input.code)) return /^\d$/.test(input.key) ? `num${input.key}` : NAMED_KEYS[input.key]
  if (input.code === 'NumpadDecimal' && input.key === 'Delete') return 'Delete'
  if (/^[a-z]$/i.test(input.key)) return input.shift ? input.key.toUpperCase() : input.key.toLowerCase()
  if (/^[!-~]$/.test(input.key)) return input.key
  const letter = /^Key([A-Z])$/.exec(input.code)?.[1]
  if (letter) return input.shift ? letter : letter.toLowerCase()
  if (/^F([1-9]|1\d|2[0-4])$/.test(input.code)) return input.code
  return NAMED_KEYS[input.code]
}

/** Keys passed on at once: modifiers alone, and the keys an input method takes. */
const PASSED_KEYS = new Set([
  'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Fn', 'FnLock', 'NumLock', 'ScrollLock', 'Dead', 'Process', 'Unidentified'
])

/** The keys with a name, by their place on the keyboard, as Electron names them. */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Tab: 'Tab',
  Escape: 'Escape',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec'
}
