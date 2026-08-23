import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CLIPBOARD_TEXT_BYTES,
  writeVerifiedClipboardText
} from '../src/main/verified-clipboard.js'

function clipboardFixture(readValues: string[]) {
  return {
    clear: vi.fn(() => undefined),
    writeText: vi.fn((_text: string) => undefined),
    readText: vi.fn(() => readValues.shift() ?? '')
  }
}

describe('verified text clipboard writes', () => {
  it('clears, writes, waits, and verifies the copied text', async () => {
    const clipboard = clipboardFixture(['agent context'])
    const delay = vi.fn(async () => undefined)

    await writeVerifiedClipboardText('agent context', clipboard, delay)

    expect(clipboard.clear).toHaveBeenCalledOnce()
    expect(clipboard.writeText).toHaveBeenCalledWith('agent context')
    expect(clipboard.readText).toHaveBeenCalledOnce()
    expect(delay).toHaveBeenCalledWith(30)
  })

  it('retries clipboard backends that temporarily reject a write', async () => {
    const clipboard = clipboardFixture(['', 'stale value', 'agent context'])
    const delay = vi.fn(async () => undefined)

    await writeVerifiedClipboardText('agent context', clipboard, delay)

    expect(clipboard.clear).toHaveBeenCalledTimes(3)
    expect(clipboard.writeText).toHaveBeenCalledTimes(3)
    expect(delay.mock.calls).toEqual([[30], [60], [90]])
  })

  it('reports a persistent clipboard failure', async () => {
    const clipboard = clipboardFixture(['', '', ''])

    await expect(writeVerifiedClipboardText('agent context', clipboard, async () => undefined))
      .rejects.toThrow('system clipboard did not accept it')
  })

  it('rejects unexpectedly large shell payloads before touching the clipboard', async () => {
    const clipboard = clipboardFixture([])
    const text = 'a'.repeat(MAX_CLIPBOARD_TEXT_BYTES + 1)

    await expect(writeVerifiedClipboardText(text, clipboard, async () => undefined))
      .rejects.toThrow('maximum 8 MB')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
})
