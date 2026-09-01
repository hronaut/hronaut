import { browserKeyCharacter, type BrowserKeyPress, type BrowserKeyModifier } from '../../shared/keyboard-input.js'

export interface KeyboardDebugger {
  sendCommand: (method: string, commandParams?: Record<string, unknown>) => Promise<unknown>
}

const modifierBits: Readonly<Record<BrowserKeyModifier, number>> = {
  alt: 1,
  control: 2,
  meta: 4,
  shift: 8
}

const namedKeys: Readonly<Record<string, { key: string; code: string; virtualKeyCode: number }>> = {
  Backspace: { key: 'Backspace', code: 'Backspace', virtualKeyCode: 8 },
  Tab: { key: 'Tab', code: 'Tab', virtualKeyCode: 9 },
  Enter: { key: 'Enter', code: 'Enter', virtualKeyCode: 13 },
  Escape: { key: 'Escape', code: 'Escape', virtualKeyCode: 27 },
  Space: { key: ' ', code: 'Space', virtualKeyCode: 32 },
  PageUp: { key: 'PageUp', code: 'PageUp', virtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', virtualKeyCode: 34 },
  End: { key: 'End', code: 'End', virtualKeyCode: 35 },
  Home: { key: 'Home', code: 'Home', virtualKeyCode: 36 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', virtualKeyCode: 37 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', virtualKeyCode: 38 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', virtualKeyCode: 39 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', virtualKeyCode: 40 },
  Insert: { key: 'Insert', code: 'Insert', virtualKeyCode: 45 },
  Delete: { key: 'Delete', code: 'Delete', virtualKeyCode: 46 }
}

const punctuationKeys: Readonly<Record<string, { code: string; virtualKeyCode: number; shifted: string }>> = {
  '`': { code: 'Backquote', virtualKeyCode: 192, shifted: '~' },
  '-': { code: 'Minus', virtualKeyCode: 189, shifted: '_' },
  '=': { code: 'Equal', virtualKeyCode: 187, shifted: '+' },
  '[': { code: 'BracketLeft', virtualKeyCode: 219, shifted: '{' },
  ']': { code: 'BracketRight', virtualKeyCode: 221, shifted: '}' },
  '\\': { code: 'Backslash', virtualKeyCode: 220, shifted: '|' },
  ';': { code: 'Semicolon', virtualKeyCode: 186, shifted: ':' },
  "'": { code: 'Quote', virtualKeyCode: 222, shifted: '"' },
  ',': { code: 'Comma', virtualKeyCode: 188, shifted: '<' },
  '.': { code: 'Period', virtualKeyCode: 190, shifted: '>' },
  '/': { code: 'Slash', virtualKeyCode: 191, shifted: '?' }
}

const shiftedDigits = ')!@#$%^&*('

function keyDescription(input: BrowserKeyPress): {
  key: string
  code: string
  virtualKeyCode: number
  text?: string
  unmodifiedText?: string
} {
  const text = browserKeyCharacter(input) ?? undefined
  const shifted = input.modifiers.includes('shift')
  const named = namedKeys[input.keyCode === ' ' ? 'Space' : input.keyCode]
  if (named) return named
  const functionKey = /^F([1-9]|1[0-2])$/.exec(input.keyCode)
  if (functionKey) {
    return { key: input.keyCode, code: input.keyCode, virtualKeyCode: 111 + Number(functionKey[1]) }
  }
  if (/^[a-z]$/i.test(input.keyCode)) {
    const lower = input.keyCode.toLowerCase()
    return {
      key: shifted ? lower.toUpperCase() : lower,
      code: `Key${lower.toUpperCase()}`,
      virtualKeyCode: lower.toUpperCase().charCodeAt(0),
      ...(text === undefined ? {} : { text, unmodifiedText: lower })
    }
  }
  if (/^[0-9]$/.test(input.keyCode)) {
    const digit = Number(input.keyCode)
    return {
      key: shifted ? shiftedDigits[digit] ?? input.keyCode : input.keyCode,
      code: `Digit${input.keyCode}`,
      virtualKeyCode: input.keyCode.charCodeAt(0),
      ...(text === undefined ? {} : { text, unmodifiedText: input.keyCode })
    }
  }
  const punctuation = punctuationKeys[input.keyCode]
  if (punctuation) {
    return {
      key: shifted ? punctuation.shifted : input.keyCode,
      code: punctuation.code,
      virtualKeyCode: punctuation.virtualKeyCode,
      ...(text === undefined ? {} : { text, unmodifiedText: input.keyCode })
    }
  }
  return {
    key: input.keyCode,
    code: input.keyCode,
    virtualKeyCode: 0,
    ...(text === undefined ? {} : { text, unmodifiedText: input.keyCode })
  }
}

export async function dispatchNativeKeyPress(
  debuggerApi: KeyboardDebugger,
  input: BrowserKeyPress
): Promise<void> {
  const modifiers = input.modifiers.reduce((value, modifier) => value | modifierBits[modifier], 0)
  const key = keyDescription(input)
  await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
    type: key.text === undefined ? 'rawKeyDown' : 'keyDown',
    modifiers,
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.virtualKeyCode,
    ...(key.text === undefined ? {} : { text: key.text, unmodifiedText: key.unmodifiedText })
  })
  await debuggerApi.sendCommand('Input.dispatchKeyEvent', {
    type: 'keyUp',
    modifiers,
    key: key.key,
    code: key.code,
    windowsVirtualKeyCode: key.virtualKeyCode
  })
}
