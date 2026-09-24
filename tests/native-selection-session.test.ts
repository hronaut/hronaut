import { describe, expect, it } from 'vitest'
import { createElementPickerSession, createNativeSelectionSession } from '../src/main/browser/native-selection-session.js'

for (const [name, create] of [
  ['area selection', createNativeSelectionSession],
  ['element picker', createElementPickerSession]
] as const) {
  describe(name, () => {
    it('exposes completion on the same session used by queued input', async () => {
      const session = create<string>()
      session.resolve('selected')
      expect(session.settled).toBe(true)
      await expect(session.result).resolves.toBe('selected')
    })

    it('keeps the first completed result when later callbacks arrive', async () => {
      const session = create<string>()
      session.resolve('first selection')
      session.resolve('late selection')
      session.reject(new Error('late failure'))
      await expect(session.result).resolves.toBe('first selection')
      expect(session.settled).toBe(true)
    })

    it('keeps a rejection authoritative over late selection completion', async () => {
      const session = create<string>()
      const rejected = expect(session.result).rejects.toThrow('Selection unavailable')
      session.reject(new Error('Selection unavailable'))
      session.resolve('late selection')
      await rejected
      expect(session.settled).toBe(true)
    })
  })
}
