// For display only: characters that render as nothing, as blank space or
// reorder text. Besides the controls, format, private-use and separator
// characters the automatic sign-in check rejects, this covers
// default-ignorable characters (such as variation selectors and Hangul
// fillers), noncharacters and the blank braille pattern.
const HIDDEN_DISPLAY_CHARACTER = /[^\P{Cc}\t\n]|[\p{Cf}\p{Co}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\u2800]/u

/**
 * Whether text holds a character that renders as nothing, as blank space or
 * reorders text: controls other than tab and line feed, format (bidirectional
 * and zero-width), default-ignorable, private-use, line or paragraph
 * separator, noncharacter or blank braille characters. Display only; the
 * automatic sign-in check keeps its own narrower rule.
 */
export function hasHiddenMessageCharacters(text: string): boolean {
  return HIDDEN_DISPLAY_CHARACTER.test(text)
}

/**
 * The first maxLength characters of text, with each hidden character shown as
 * a visible [U+XXXX] marker. It never splits a character or a marker.
 */
export function revealHiddenMessageCharacters(text: string, maxLength: number): { text: string; truncated: boolean } {
  let visible = ''
  for (const character of text) {
    const piece = HIDDEN_DISPLAY_CHARACTER.test(character)
      ? `[U+${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}]`
      : character
    if (visible.length + piece.length > maxLength) return { text: visible, truncated: true }
    visible += piece
  }
  return { text: visible, truncated: false }
}
