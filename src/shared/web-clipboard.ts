export type WebClipboardWriteResult = 'primary' | 'fallback'

export async function writeWebClipboardText(
  text: string,
  primaryWrite: (text: string) => Promise<void>,
  fallbackWrite: (text: string) => boolean
): Promise<WebClipboardWriteResult> {
  try {
    await primaryWrite(text)
    return 'primary'
  } catch (primaryError) {
    try {
      if (fallbackWrite(text)) return 'fallback'
    } catch {
      // Report one stable user-facing error below regardless of the legacy backend failure.
    }
    throw new Error('Clipboard access was blocked. The configuration is selected so you can copy it manually.', {
      cause: primaryError
    })
  }
}
