import { describe, expect, it, vi } from 'vitest'
import {
  SETUP_FEEDBACK_URL,
  setupFeedbackHandler
} from '../src/main/setup-feedback-links.js'

describe('setup feedback links', () => {
  it('checks the trusted Home sender and opens the fixed privacy-safe form URL', async () => {
    const assertTrustedSender = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const handler = setupFeedbackHandler(assertTrustedSender, openExternal)
    const event = { sender: 'home' }

    await handler(event)

    expect(assertTrustedSender).toHaveBeenCalledWith(event)
    expect(openExternal).toHaveBeenCalledWith(SETUP_FEEDBACK_URL)
    expect(SETUP_FEEDBACK_URL).toBe('https://hronaut.dev/go/desktop-setup-feedback')
    expect(new URL(SETUP_FEEDBACK_URL).search).toBe('')
    expect(new URL(SETUP_FEEDBACK_URL).hash).toBe('')
  })

  it('does not open anything for an untrusted sender', async () => {
    const openExternal = vi.fn(async () => undefined)
    const handler = setupFeedbackHandler(() => { throw new Error('Untrusted Home sender') }, openExternal)

    await expect(handler({})).rejects.toThrow('Untrusted Home sender')
    expect(openExternal).not.toHaveBeenCalled()
  })
})
