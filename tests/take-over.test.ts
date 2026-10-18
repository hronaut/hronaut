import { describe, expect, it } from 'vitest'
import { handBackNote, pageShortcut, type TakeOverMark } from '../src/main/browser/take-over.js'

const start: TakeOverMark = { at: 1_000_000, url: 'https://shop.example/cart', navigationGeneration: 4, humanInteractionGeneration: 10 }

describe('hand-back note', () => {
  it('says how long the person had the tab, where the page went and that they used it', () => {
    expect(handBackNote(start, { at: start.at + 42_400, url: 'https://shop.example/checkout', navigationGeneration: 5, humanInteractionGeneration: 14 })).toBe(
      'The person had this tab for 42 s and handed it back. The page moved from https://shop.example/cart to https://shop.example/checkout. '
      + 'They clicked or typed in the page. Read the page again before you continue.'
    )
  })

  it('tells a reload at the same address from a page left alone', () => {
    expect(handBackNote(start, { ...start, at: start.at + 3 * 60_000, navigationGeneration: 6 })).toBe(
      'The person had this tab for 3 min and handed it back. The page reloaded or navigated and is at the same address again. '
      + 'They did not click or type in the page. Read the page again before you continue.'
    )
    expect(handBackNote(start, { ...start, at: start.at + 125 * 60_000 })).toBe(
      'The person had this tab for 2 h 5 min and handed it back. The page stayed at the same address. '
      + 'They did not click or type in the page. Read the page again before you continue.'
    )
  })

  it('keeps long addresses short and never counts time backwards', () => {
    const long = `https://shop.example/${'a'.repeat(400)}`
    const note = handBackNote(start, { ...start, at: start.at - 5_000, url: long })
    expect(note).toContain('for 0 s')
    expect(note).toContain(`to ${long.slice(0, 199)}….`)
    expect(note).not.toContain(long.slice(0, 201))
  })
})

describe('hand-back note privacy', () => {
  it('names addresses without sign-in details, secret query values or the fragment', () => {
    const note = handBackNote(
      { ...start, url: 'https://user:pass@shop.example/login?token=abc123&step=2#secret' },
      { ...start, at: start.at + 1_000, url: 'https://shop.example/account?session=xyz' }
    )
    expect(note).toContain('from https://%5BREDACTED%5D:%5BREDACTED%5D@shop.example/login?step=2&token=%5BREDACTED%5D to https://shop.example/account?session=%5BREDACTED%5D.')
    expect(note).not.toMatch(/user:pass|abc123|xyz|#secret/)
  })

  it('names addresses as origin and path only for agents kept from URL detail', () => {
    const note = handBackNote(
      { ...start, url: 'https://user:pass@shop.example/login?step=2&coupon=SPRING#secret' },
      { ...start, at: start.at + 1_000, url: 'https://shop.example/confirm?order=98765&email=a%40b.test' },
      true
    )
    expect(note).toContain('from https://shop.example/login to https://shop.example/confirm.')
    expect(note).not.toMatch(/user|pass|step|SPRING|98765|email|secret|REDACTED/)
  })
})

describe('keys pressed in a page', () => {
  it('runs a shortcut that is available there', () => {
    expect(pageShortcut('take-over', { available: true, expectedAgentInput: false })).toBe('take-over')
    expect(pageShortcut('reload', { available: true, expectedAgentInput: true })).toBe('reload')
    expect(pageShortcut(null, { available: true, expectedAgentInput: false })).toBeNull()
    expect(pageShortcut('take-over', { available: false, expectedAgentInput: false })).toBeNull()
  })

  it('leaves keys only a person uses to the page when an agent sends them', () => {
    // An agent pressing Ctrl+Shift+O for a web app's own command must not take the page over from itself.
    expect(pageShortcut('take-over', { available: true, expectedAgentInput: true })).toBeNull()
    expect(pageShortcut('agent-card', { available: true, expectedAgentInput: true })).toBeNull()
  })
})
