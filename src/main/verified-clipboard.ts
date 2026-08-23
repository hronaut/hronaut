export const MAX_CLIPBOARD_TEXT_BYTES = 8 * 1024 * 1024

export interface TextClipboard {
  clear(): void
  writeText(text: string): void
  readText(): string
}

type Wait = (milliseconds: number) => Promise<void>

const wait: Wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function writeVerifiedClipboardText(
  text: string,
  target: TextClipboard,
  delay: Wait = wait
): Promise<void> {
  if (Buffer.byteLength(text, 'utf8') > MAX_CLIPBOARD_TEXT_BYTES) {
    throw new Error('The text is too large to copy safely (maximum 8 MB)')
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    target.clear()
    target.writeText(text)
    await delay(30 * (attempt + 1))
    if (target.readText() === text) return
  }

  throw new Error('The text was prepared, but the system clipboard did not accept it')
}
