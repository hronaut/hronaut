import { describe, expect, it } from 'vitest'
import { formatReproAsPlaywright } from '../src/shared/repro-export.js'
import type { BrowserReproRecording, BrowserReproStep } from '../src/shared/types.js'

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
    expect(result).toContain('page.locator("css:light=#card").fill(reproInput2)')
    expect(result).toContain('page.locator("css:light=#card").press("Control+Enter")')
    expect(result).toContain('page.locator("css:light=button:nth-of-type(2)").click()')
    expect(result).toContain('window.scrollTo(x, y), {"x":0,"y":640}')
    expect(result).toContain('TODO: replace this line with an assertion')
    expect(result).not.toContain('card-secret')
  })

  it.each(['click', 'input', 'key', 'scroll', 'expect', 'incomplete text expectation'] as const)(
    'does not let a passing checkpoint hide an unresolved %s step', async kind => {
      const checkpoint: BrowserReproStep = {
        ...recording.steps[0]!, kind: 'expect',
        target: { selector: '#ready', tag: 'p' },
        expectation: { condition: 'text', text: 'Ready', observedMatch: true }
      }
      const unresolved: BrowserReproStep = {
        ...recording.steps[0]!, index: 2, kind: kind === 'incomplete text expectation' ? 'expect' : kind,
        target: { selector: kind === 'incomplete text expectation' ? '#ready' : '', tag: 'button' },
        ...(kind === 'incomplete text expectation' ? { expectation: { condition: 'text' as const, observedMatch: true } } : {})
      }
      const code = formatReproAsPlaywright({ ...recording, steps: [checkpoint, unresolved], stepCount: 2 })
      let execution: Promise<void> | undefined
      const page = { locator: () => ({}) }
      let assertions = 0
      const assert = () => ({ toHaveText: async () => { assertions += 1 } })
      const register = (_name: string, body: (context: { page: typeof page }) => Promise<void>) => {
        execution = body({ page })
      }
      new Function('test', 'expect', code.replace(/^import[^\n]*\n/u, ''))(register, assert)

      expect(execution).toBeDefined()
      await expect(execution).rejects.toThrow(kind === 'incomplete text expectation'
        ? 'TODO: Recreate unsupported expectation at step 2'
        : `TODO: Recreate step 2: ${kind}`)
      expect(assertions).toBe(1)
    }
  )

  it.each([false, true])('requires review before replaying a truncated timeline (truncated=%s)', async truncated => {
    const checkpoint: BrowserReproStep = {
      ...recording.steps[0]!, index: 2, kind: 'expect',
      target: { selector: '#ready', tag: 'p' },
      expectation: { condition: 'text', text: 'Ready', observedMatch: true }
    }
    const code = formatReproAsPlaywright({ ...recording, truncated, steps: [recording.steps[0]!, checkpoint], stepCount: 2 })
    let execution: Promise<void> | undefined
    let actions = 0
    const page = { goto: async () => { actions += 1 }, locator: () => ({}) }
    const assert = () => ({ toHaveText: async () => { actions += 1 } })
    new Function('test', 'expect', code.replace(/^import[^\n]*\n/u, ''))(
      (_name: string, body: (context: { page: typeof page }) => Promise<void>) => { execution = body({ page }) }, assert
    )
    expect(execution).toBeDefined()
    if (truncated) {
      await expect(execution).rejects.toThrow('TODO: Complete the truncated recording before running this test')
      expect(actions).toBe(0)
    } else {
      await execution
      expect(actions).toBe(2)
    }
    expect(code).toContain('await page.goto(')
    expect(code).toContain('.toHaveText("Ready")')
  })

  it('warns when the exported timeline is active or truncated', () => {
    const result = formatReproAsPlaywright({ ...recording, active: true, truncated: true })
    expect(result).toContain('recording was still active')
    expect(result).toContain('flow is incomplete')
  })
  it('leaves unresolved target actions as manual steps instead of global keyboard input', () => {
    const result = formatReproAsPlaywright({ ...recording, steps: [
      { ...recording.steps[2]!, target: { selector: '', tag: 'input' } }
    ] })
    expect(result).toContain('// TODO: Recreate step 3: key')
    expect(result).not.toContain('page.keyboard.press')
  })

})
