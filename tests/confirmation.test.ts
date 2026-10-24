import { describe, expect, it } from 'vitest'
import { splitConfirmation } from '../src/shared/confirmation.js'

/** Writes a message as a translation does, putting each parameter in for its {name}. */
const format = (template: string) => (parameters: Record<string, string | number>): string => (
  template.replace(/\{(\w+)\}/gu, (_placeholder, name: string) => String(parameters[name] ?? ''))
)

describe('splitting a confirmation after its question', () => {
  it('shows the question as the headline and what the change means under it', () => {
    expect(splitConfirmation(format('Close workspace "{name}"? Its tabs and data will be deleted.'), { name: 'Work' })).toEqual({
      message: 'Close workspace "Work"?',
      detail: 'Its tabs and data will be deleted.'
    })
  })

  it('keeps a name with a question mark in it whole', () => {
    expect(splitConfirmation(format('Delete "{name}"? This cannot be undone.'), { name: 'Why? Because' })).toEqual({
      message: 'Delete "Why? Because"?',
      detail: 'This cannot be undone.'
    })
  })

  it('splits before a parameter that carries what follows, and keeps a lone question whole', () => {
    expect(splitConfirmation(format('Clear {kind} for {host}?{note}'), { kind: 'cookies', host: 'example.com', note: ' HttpOnly cookies stay.' }))
      .toEqual({ message: 'Clear cookies for example.com?', detail: 'HttpOnly cookies stay.' })
    expect(splitConfirmation(format('Clear {kind} for {host}?{note}'), { kind: 'cookies', host: 'example.com', note: '' }))
      .toEqual({ message: 'Clear cookies for example.com?' })
  })

  it('keeps the paragraphs and lines after the question', () => {
    expect(splitConfirmation(format('Clear history?\n\n{items}\n\nCookies stay.'), { items: '- Visits\n- Suggestions' })).toEqual({
      message: 'Clear history?',
      detail: '- Visits\n- Suggestions\n\nCookies stay.'
    })
  })

  it('takes a question that opens with its own mark and a full-width question mark', () => {
    expect(splitConfirmation(format('¿Cerrar "{name}"? Se borrarán sus datos.'), { name: 'A' }))
      .toEqual({ message: '¿Cerrar "A"?', detail: 'Se borrarán sus datos.' })
    expect(splitConfirmation(format('關閉？ 資料將刪除。')))
      .toEqual({ message: '關閉？', detail: '資料將刪除。' })
  })

  it('keeps a message without a question, or with numbers in it, as one headline when nothing follows', () => {
    expect(splitConfirmation(format('Deactivate this license.'))).toEqual({ message: 'Deactivate this license.' })
    expect(splitConfirmation(format('Close {count} tabs?'), { count: 3 })).toEqual({ message: 'Close 3 tabs?' })
  })
})
