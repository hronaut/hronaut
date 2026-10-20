// The English notes Hronaut writes in place of a request or response body.
// MCP results, HAR files and copies keep this text; the Network panel names
// each note in the interface language.

/** Written as the body text when the body itself is withheld. */
export const NETWORK_BODY_PLACEHOLDERS = {
  binary: '[binary body omitted]',
  multipart: '[multipart body omitted]',
  unsafeJson: '[JSON body omitted: could not safely redact]',
  nonText: '[non-text body omitted]'
} as const

/** Written as the reason when a response body is unavailable. */
export const NETWORK_BODY_UNAVAILABLE_REASONS = {
  eventStream: 'Server-sent events are available in the bounded Event stream section.',
  webSocket: 'WebSocket messages are available in the bounded messages section.',
  expired: 'Response body is no longer available from Chromium.',
  incomplete: 'The response body has not completed.',
  devToolsCapture: 'Detailed capture was unavailable while Developer Tools owned this tab.',
  omittedFromExport: 'Response body was omitted from this sanitized export.',
  closeDevTools: 'Close Developer Tools for this tab, then request these details again.',
  evicted: 'Chromium no longer has this response body in its bounded diagnostic buffer.'
} as const

export type NetworkBodyPlaceholder = keyof typeof NETWORK_BODY_PLACEHOLDERS
export type NetworkBodyUnavailableReason = keyof typeof NETWORK_BODY_UNAVAILABLE_REASONS

function noteKey<Key extends string>(notes: Readonly<Record<Key, string>>, text: string | undefined): Key | undefined {
  if (text === undefined) return undefined
  return (Object.keys(notes) as Key[]).find((key) => notes[key] === text)
}

export function networkBodyPlaceholder(text: string | undefined): NetworkBodyPlaceholder | undefined {
  return noteKey(NETWORK_BODY_PLACEHOLDERS, text)
}

export function networkBodyUnavailableReason(text: string | undefined): NetworkBodyUnavailableReason | undefined {
  return noteKey(NETWORK_BODY_UNAVAILABLE_REASONS, text)
}
