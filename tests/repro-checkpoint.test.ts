// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { reproCheckpointSchema } from '../src/shared/repro-checkpoint.js'
import { reproCheckpointScript } from '../src/main/browser/repro-checkpoint-script.js'
import { formatReproAsPlaywright } from '../src/shared/repro-export.js'
import type { BrowserReproRecording } from '../src/shared/types.js'

const input = { context: 'c9a69713-c421-4d51-913e-0f7e74248acd', selector: '#result', condition: 'text' as const, text: 'Saved successfully', reviewed: true as const }
const recording: BrowserReproRecording = { tabId: 'tab', title: 'Fixture', active: false, stepCount: 1, truncated: false, caveats: [], steps: [{ index: 1, kind: 'expect', occurredAt: '2026-10-01T00:00:00Z', elapsedMs: 1, url: 'https://example.test', description: 'Expected result', target: { selector: 'main > p', tag: 'p' }, expectation: { condition: 'text', text: 'Saved successfully', observedMatch: false } }] }

describe('explicit Repro checkpoints', () => {
  it('requires review, bounded expected text and an exact recording context', () => {
    expect(reproCheckpointSchema.safeParse(input).success).toBe(true)
    for (const changed of [{ reviewed: false }, { text: 'x'.repeat(241) }, { context: '' }, { condition: 'visible' }, { unexpected: true }]) {
      expect(reproCheckpointSchema.safeParse({ ...input, ...changed }).success).toBe(false)
    }
  })
  it('returns only a structural target and match flag, never observed private text', () => {
    document.body.innerHTML = '<main><p id="result">private unrelated result</p></main>'
    try {
      const result = window.eval(reproCheckpointScript(input))
      expect(result).toEqual({ selector: 'p', tag: 'p', observedMatch: false })
      expect(JSON.stringify(result)).not.toContain('private')
      window.document.querySelector('p')!.textContent = 'Saved  successfully'
      expect(window.eval(reproCheckpointScript(input)).observedMatch).toBe(true)
    } finally { document.body.replaceChildren() }
  })
  it('rejects missing, ambiguous and editable targets', () => {
    document.body.innerHTML = '<main><p></p><p></p><input value="private"><div contenteditable="true">private</div></main>'
    try {
      for (const [selector, error] of [['#missing', 'ambiguous-target'], ['p', 'ambiguous-target'], ['input', 'excluded-target'], ['main', 'excluded-target'], ['[contenteditable]', 'excluded-target'], ['[', 'invalid-selector']]) {
        expect(window.eval(reproCheckpointScript({ ...input, selector: selector! }))).toEqual({ error })
      }
    } finally { document.body.replaceChildren() }
  })
  it('exports the intended assertion even when the observed result failed', () => {
    const code = formatReproAsPlaywright(recording)
    expect(code).toContain('await expect(page.locator("css:light=main \\u003e p")).toHaveText("Saved successfully")')
    expect(code).not.toContain('throw new Error')
    expect(code).not.toContain('observedMatch')
  })
  it('retains the failing assertion TODO for unsupported or unmarked expectations', () => {
    expect(formatReproAsPlaywright({ ...recording, steps: [] })).toContain('TODO: replace this line')
    expect(formatReproAsPlaywright({ ...recording, steps: [{ ...recording.steps[0]!, target: { selector: '', tag: 'p' } }] })).toContain('TODO: replace this line')
  })
})
