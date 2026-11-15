/** The character each key of a US keyboard's punctuation types without Shift. */
const US_PUNCTUATION: Readonly<Record<string, string>> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Backquote: '`', Comma: ',', Period: '.', Slash: '/'
}

/**
 * The key a shortcut goes by, in lower case, from a key event's `key` and `code`. A key of the number row goes by its
 * digit whatever it types, as Chromium reads it, so Ctrl+1 and Ctrl+2 select the first and second tab with AZERTY,
 * where those keys type & and é, and Ctrl with AZERTY's - on the 6 key selects the sixth tab. A letter of another
 * script, such as a Russian, Ukrainian or Greek letter, goes by its key's place on a US keyboard, as in Chrome, so
 * Ctrl+L still focuses the address with such a layout on. A Latin letter, such as the Turkish ı or the German ß, keeps
 * its own, so a layout of Latin letters gains no browser keys Chrome doesn't have there.
 */
export function shortcutKey(input: { readonly key: string; readonly code?: string }): string {
  const characters = [...input.key]
  if (characters.length !== 1) return input.key.toLowerCase()
  const code = input.code ?? ''
  const digit = /^Digit([0-9])$/u.exec(code)?.[1]
  if (digit) return digit
  if (characters[0]!.codePointAt(0)! < 0x80) return input.key.toLowerCase()
  if (/\p{Script=Latin}/u.test(characters[0]!)) return input.key.toLowerCase()
  return /^Key([A-Z])$/u.exec(code)?.[1]?.toLowerCase() ?? US_PUNCTUATION[code] ?? input.key.toLowerCase()
}
