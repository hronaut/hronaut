/** What an agent reads in place of text the person typed. */
export const TYPED_TEXT_REDACTION = '[redacted]'
/** Shorter text, such as a word or a PIN digit, is too common to hide everywhere it appears. */
export const TYPED_TEXT_MIN_LENGTH = 4
/** Longer text is kept by its lines, which pages show and send one at a time. */
export const TYPED_TEXT_MAX_LENGTH = 1_000

/**
 * The texts to hide for what the person entered: the whole value and each of its lines, trimmed, of at least four
 * characters and at most a thousand.
 */
export function typedTexts(value: string): string[] {
  const texts = new Set<string>()
  for (const text of [value, ...value.split(/\r\n|\r|\n/)]) {
    const trimmed = text.trim()
    if (trimmed.length >= TYPED_TEXT_MIN_LENGTH && trimmed.length <= TYPED_TEXT_MAX_LENGTH) texts.add(trimmed)
  }
  return [...texts]
}

/**
 * The forms text the person typed takes in what an agent reads: as typed, URL-encoded as in a query or as a form body
 * encodes it, which also escapes !'()~ (spaces as %20 or +), and each of those escaped once or twice as in a JSON
 * string, such as a request body that a JSON result quotes.
 */
export function typedTextForms(value: string): string[] {
  const forms = new Set<string>()
  const encoded = encodeURIComponent(value)
  const formEncoded = new URLSearchParams([['', value]]).toString().slice(1)
  for (const form of [value, encoded, encoded.replace(/%20/g, '+'), formEncoded, formEncoded.replace(/\+/g, '%20')]) {
    const escaped = JSON.stringify(form).slice(1, -1)
    forms.add(form).add(escaped).add(JSON.stringify(escaped).slice(1, -1))
  }
  return [...forms].filter(form => form.length >= TYPED_TEXT_MIN_LENGTH)
}

/** One pattern for every form of these texts, longest first, ignoring case; null when there is nothing to hide. */
export function typedTextPattern(values: Iterable<string>): RegExp | null {
  const forms = [...new Set([...values].flatMap(typedTextForms))].sort((a, b) => b.length - a.length)
  if (!forms.length) return null
  return new RegExp(forms.map(form => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu')
}

/** The text with every form of what the person typed replaced by [redacted]. */
export function redactTypedText(text: string, pattern: RegExp | null): string {
  if (!pattern || text.length < TYPED_TEXT_MIN_LENGTH) return text
  pattern.lastIndex = 0
  return text.replace(pattern, TYPED_TEXT_REDACTION)
}
