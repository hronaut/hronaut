import { describe, expect, it, vi } from 'vitest'
import {
  MAX_CLIPBOARD_TEXT_BYTES,
  writeVerifiedClipboardText
} from '../src/main/verified-clipboard.js'

function clipboardFixture(readValues: string[]) {
  return {
    clear: vi.fn(() => undefined),
    writeText: vi.fn(async (_text: string): Promise<void> => undefined),
    readText: vi.fn(async () => readValues.shift() ?? '')
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

  it('waits for the write to settle before reading, and for readback before completing', async () => {
    let finishWrite!: () => void
    let finishRead!: (value: string) => void
    const clipboard = clipboardFixture([])
    clipboard.writeText.mockImplementation(() => new Promise<void>((resolve) => { finishWrite = resolve }))
    clipboard.readText.mockImplementation(() => new Promise<string>((resolve) => { finishRead = resolve }))
    const delay = vi.fn(async () => undefined)
    const completed = vi.fn()
    const pending = writeVerifiedClipboardText('new text', clipboard, delay).then(completed)
    expect(delay).not.toHaveBeenCalled()
    expect(clipboard.readText).not.toHaveBeenCalled()
    finishWrite()
    await vi.waitFor(() => expect(clipboard.readText).toHaveBeenCalledOnce())
    expect(completed).not.toHaveBeenCalled()
    finishRead('new text')
    await pending
    expect(completed).toHaveBeenCalledOnce()
  })

  it.each(['writeText', 'readText'] as const)('propagates asynchronous %s rejection without retrying or reporting success', async (method) => {
    const clipboard = clipboardFixture(['new text'])
    clipboard[method].mockRejectedValueOnce(new Error('backend rejected operation'))
    await expect(writeVerifiedClipboardText('new text', clipboard, async () => undefined))
      .rejects.toThrow('backend rejected operation')
    expect(clipboard.clear).toHaveBeenCalledOnce()
    expect(clipboard[method]).toHaveBeenCalledOnce()
    if (method === 'writeText') expect(clipboard.readText).not.toHaveBeenCalled()
  })

  it('rejects unexpectedly large shell payloads before touching the clipboard', async () => {
    const clipboard = clipboardFixture([])
    const text = 'a'.repeat(MAX_CLIPBOARD_TEXT_BYTES + 1)

    await expect(writeVerifiedClipboardText(text, clipboard, async () => undefined))
      .rejects.toThrow('maximum 8 MB')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
})
