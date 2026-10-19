import { describe, expect, it } from 'vitest'
import { errorText } from '../../src/renderer/src/home/dom.js'

describe('Home error text', () => {
  it('shows a main-process failure without the wrapper Electron puts around it', () => {
    const failure = new Error("Error invoking remote method 'hronaut-home:workspace-action': Error: Робочий простір більше недоступний.")
    expect(errorText(failure, 'fallback')).toBe('Робочий простір більше недоступний.')
    expect(errorText(new Error('Plain words'), 'fallback')).toBe('Plain words')
  })

  it('falls back when the failure has no words of its own', () => {
    expect(errorText(new Error("Error invoking remote method 'hronaut-home:copy-text': Error: "), 'Copy failed')).toBe('Copy failed')
    expect(errorText('not an error', 'Copy failed')).toBe('Copy failed')
  })
})
