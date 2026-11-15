// What text an insertion takes, apart from the insertion itself, which reaches Electron, so the MCP tool that checks
// the text's length loads in plain Node too.

/** The longest text one insertion takes, in UTF-16 code units. */
export const MAX_INSERTED_TEXT_LENGTH = 4096

/** Why the text cannot be inserted, or undefined when it can. Messages never repeat the text. */
export function insertableTextProblem(text: string): string | undefined {
  if (text.length === 0 || text.length > MAX_INSERTED_TEXT_LENGTH) return `Provide 1 to ${MAX_INSERTED_TEXT_LENGTH} characters of text (counted in UTF-16 code units).`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/u.test(text)) return 'The text may contain line breaks (\\n) and tabs, but no other control characters.'
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)) return 'The text contains an unpaired surrogate, which is not a character.'
  return undefined
}
