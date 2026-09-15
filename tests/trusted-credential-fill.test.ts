import { describe, expect, it, vi } from 'vitest'
import { recordTrustedCredentialFill } from '../src/main/browser/trusted-credential-fill.js'

describe('trusted credential fill authority', () => {
  it('advances human authority only after a successful fill', () => {
    const tab = {
      humanInteractionGeneration: 4,
      lastHumanInteractionAt: 100,
      lastActiveAt: 200
    }
    const onUserInteraction = vi.fn()

    expect(recordTrustedCredentialFill(false, tab, 300, onUserInteraction)).toBe(false)
    expect(tab).toEqual({
      humanInteractionGeneration: 4,
      lastHumanInteractionAt: 100,
      lastActiveAt: 200
    })
    expect(onUserInteraction).not.toHaveBeenCalled()

    expect(recordTrustedCredentialFill(true, tab, 400, onUserInteraction)).toBe(true)
    expect(tab).toEqual({
      humanInteractionGeneration: 5,
      lastHumanInteractionAt: 400,
      lastActiveAt: 400
    })
    expect(onUserInteraction).toHaveBeenCalledOnce()
  })
})
