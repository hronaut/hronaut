import { describe, expect, it, vi } from 'vitest'
import { writeWebClipboardText } from '../src/shared/web-clipboard.js'

describe('public website clipboard fallback', () => {
  it('uses the modern clipboard API without touching the fallback', async () => {
    const primary = vi.fn(async () => undefined)
    const fallback = vi.fn(() => true)

    await expect(writeWebClipboardText('agent setup', primary, fallback)).resolves.toBe('primary')
    expect(primary).toHaveBeenCalledWith('agent setup')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back when browser clipboard permission is unavailable', async () => {
    const primary = vi.fn(async () => { throw new Error('NotAllowedError') })
    const fallback = vi.fn(() => true)

    await expect(writeWebClipboardText('agent setup', primary, fallback)).resolves.toBe('fallback')
    expect(fallback).toHaveBeenCalledWith('agent setup')
  })

  it('returns an actionable failure when both clipboard backends reject the copy', async () => {
    const primary = vi.fn(async () => { throw new Error('NotAllowedError') })

    await expect(writeWebClipboardText('agent setup', primary, () => false))
      .rejects.toThrow('selected so you can copy it manually')
  })
})
