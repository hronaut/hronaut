import { describe, expect, it } from 'vitest'
import { formatReproAsPlaywright } from '../src/shared/repro-export.js'
import type { BrowserReproRecording } from '../src/shared/types.js'

const recording: BrowserReproRecording = {
  tabId: 'tab-1',
  title: "Checkout's failure",
  startedAt: '2026-08-15T12:00:00.000Z',
  stoppedAt: '2026-08-15T12:00:05.000Z',
  active: false,
  stepCount: 5,
  truncated: false,
  caveats: [],
  steps: [
    { index: 1, kind: 'navigate', occurredAt: '2026-08-15T12:00:00.000Z', elapsedMs: 0, description: 'Open checkout', url: 'https://example.test/checkout' },
    { index: 2, kind: 'input', occurredAt: '2026-08-15T12:00:01.000Z', elapsedMs: 1_000, description: 'Type card', url: 'https://example.test/checkout', target: { selector: '#card', tag: 'input' }, valueRedacted: true },
    { index: 3, kind: 'key', occurredAt: '2026-08-15T12:00:02.000Z', elapsedMs: 2_000, description: 'Submit', url: 'https://example.test/checkout', target: { selector: '#card', tag: 'input' }, key: 'Ctrl+Enter' },
    { index: 4, kind: 'click', occurredAt: '2026-08-15T12:00:03.000Z', elapsedMs: 3_000, description: 'Click pay', url: 'https://example.test/checkout', target: { selector: 'button:nth-of-type(2)', tag: 'button' } },
    { index: 5, kind: 'scroll', occurredAt: '2026-08-15T12:00:04.000Z', elapsedMs: 4_000, description: 'Scroll', url: 'https://example.test/checkout', scroll: { x: 0, y: 640 } }
  ]
}

describe('Playwright repro export', () => {
  it('produces a reviewable test without inventing redacted input values', () => {
    const result = formatReproAsPlaywright(recording)

    expect(result).toContain("import { test } from '@playwright/test'")
    expect(result).toContain(`test("reproduce: Checkout's failure"`)
    expect(result).toContain('await page.goto("https://example.test/checkout")')
    expect(result).toContain('process.env.HRONAUT_REPRO_INPUT_2')
    expect(result).toContain('page.locator("#card").fill(reproInput2)')
    expect(result).toContain('page.locator("#card").press("Control+Enter")')
    expect(result).toContain('page.locator("button:nth-of-type(2)").click()')
    expect(result).toContain('window.scrollTo(x, y), {"x":0,"y":640}')
    expect(result).toContain('TODO: replace this line with an assertion')
    expect(result).not.toContain('card-secret')
  })

  it('warns when the exported timeline is active or truncated', () => {
    const result = formatReproAsPlaywright({ ...recording, active: true, truncated: true })
    expect(result).toContain('recording was still active')
    expect(result).toContain('flow is incomplete')
  })
})
