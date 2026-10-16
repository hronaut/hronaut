import { describe, expect, it } from 'vitest'
import { handBackNote, type TakeOverMark } from '../src/main/browser/take-over.js'

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
