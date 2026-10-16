import { describe, expect, it } from 'vitest'
import { AGENT_STEP_KINDS, AGENT_STEP_TARGET_KINDS, agentStepAddress, agentStepTakesTarget } from '../src/shared/agent-steps.js'

describe('agent step targets', () => {
  it('shows an address as its host and path only', () => {
    expect(agentStepAddress('https://user:secret@shop.example/checkout?token=canary#pay')).toBe('shop.example/checkout')
    expect(agentStepAddress('http://127.0.0.1:4173/')).toBe('127.0.0.1:4173')
    expect(agentStepAddress('https://shop.example')).toBe('shop.example')
    expect(agentStepAddress('https://bücher.example/a b')).toBe('xn--bcher-kva.example/a%20b')
  })

  it('shows no address for pages that are not on the web, or for text that is not an address', () => {
    for (const url of ['data:text/html,<p>canary</p>', 'blob:https://shop.example/1', 'file:///home/user/canary.html', 'about:blank', 'javascript:alert(1)', 'shop.example', '']) {
      expect(agentStepAddress(url), url).toBeUndefined()
    }
  })

  it('names a target only for steps that act on one element or address', () => {
    expect(AGENT_STEP_TARGET_KINDS.every((kind) => (AGENT_STEP_KINDS as readonly string[]).includes(kind))).toBe(true)
    expect(AGENT_STEP_KINDS.filter(agentStepTakesTarget).sort()).toEqual([...AGENT_STEP_TARGET_KINDS].sort())
    for (const kind of ['read', 'screenshot', 'script', 'askYou', 'pressKey', 'scroll'] as const) expect(agentStepTakesTarget(kind)).toBe(false)
  })
})
