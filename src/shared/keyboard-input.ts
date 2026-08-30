export const MAX_BROWSER_KEY_PRESS_LENGTH = 128

export type BrowserKeyModifier = 'control' | 'shift' | 'alt' | 'meta'

export interface BrowserKeyPress {
  keyCode: string
  modifiers: BrowserKeyModifier[]
  emitsCharacter: boolean
}

const modifierAliases = new Map<string, BrowserKeyModifier>([
  ['alt', 'alt'],
  ['cmd', 'meta'],
  ['command', 'meta'],
  ['control', 'control'],
  ['ctrl', 'control'],
  ['meta', 'meta'],
  ['shift', 'shift']
])

const shiftedAsciiCharacters: Readonly<Record<string, string>> = {
  '`': '~',
  '1': '!',
  '2': '@',
  '3': '#',
  '4': '$',
  '5': '%',
  '6': '^',
  '7': '&',
  '8': '*',
  '9': '(',
  '0': ')',
  '-': '_',
  '=': '+',
  '[': '{',
  ']': '}',
  '\\': '|',
  ';': ':',
  "'": '"',
  ',': '<',
  '.': '>',
  '/': '?'
}

function keyboardModifier(value: string): BrowserKeyModifier | undefined {
  return modifierAliases.get(value.trim().toLowerCase())
}

export function parseBrowserKeyPress(value: string): BrowserKeyPress {
  const input = value.trim()
  if (!input) throw new TypeError('Keyboard key must not be empty')
  if (input.length > MAX_BROWSER_KEY_PRESS_LENGTH) {
    throw new TypeError(`Keyboard key must be at most ${MAX_BROWSER_KEY_PRESS_LENGTH} characters`)
  }
  if (/[\r\n\0]/.test(input)) throw new TypeError('Keyboard key contains unsupported characters')

  const modifiers: BrowserKeyModifier[] = []
  let keyCode = input
  while (keyCode.includes('+')) {
    const separator = keyCode.indexOf('+')
    const modifierToken = keyCode.slice(0, separator)
    const modifier = keyboardModifier(modifierToken)
    if (!modifier) break
    if (modifiers.includes(modifier)) {
      throw new TypeError(`Duplicate keyboard modifier: ${modifierToken.trim()}`)
    }
    modifiers.push(modifier)
    keyCode = keyCode.slice(separator + 1)
  }

  keyCode = keyCode.trim()
  if (!keyCode) throw new TypeError('Keyboard combination is missing its key')
  if (keyCode !== '+' && keyCode.includes('+')) {
    throw new TypeError('Keyboard combination must contain exactly one non-modifier key')
  }

  return {
    keyCode,
    modifiers,
    emitsCharacter: keyCode.length === 1 && !modifiers.some((modifier) =>
      modifier === 'control' || modifier === 'alt' || modifier === 'meta'
    )
  }
}

export function browserKeyCharacter(input: BrowserKeyPress): string | null {
  if (!input.emitsCharacter) return null
  if (!input.modifiers.includes('shift')) return input.keyCode
  if (/^[a-z]$/i.test(input.keyCode)) return input.keyCode.toUpperCase()
  return shiftedAsciiCharacters[input.keyCode] ?? input.keyCode
}
