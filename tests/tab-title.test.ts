import { describe, expect, it } from 'vitest'
import { tabTitleForDisplay, UNTITLED_TAB_TITLE } from '../src/shared/tab-title.js'
import { normalizeTabTitle } from '../src/main/browser/tab-metadata.js'

describe('tab titles for display', () => {
  it('names a blank tab that has no title of its own in the interface language', () => {
    // Hronaut gave every blank tab the English title "New tab", which the interface showed in every language.
    expect(tabTitleForDisplay({ title: UNTITLED_TAB_TITLE, url: 'about:blank' }, 'Нова вкладка')).toBe('Нова вкладка')
    expect(tabTitleForDisplay({ title: '', url: 'about:blank' }, 'Neuer Tab')).toBe('Neuer Tab')
    expect(tabTitleForDisplay({ title: '', url: 'https://example.test/' }, 'Nouvel onglet')).toBe('Nouvel onglet')
  })

  it('keeps every title a page gave itself, even "New tab"', () => {
    expect(tabTitleForDisplay({ title: 'New tab', url: 'https://example.test/new' }, 'Нова вкладка')).toBe('New tab')
    expect(tabTitleForDisplay({ title: 'Checkout', url: 'about:blank' }, 'Нова вкладка')).toBe('Checkout')
    expect(tabTitleForDisplay({ title: 'new tab', url: 'about:blank' }, 'Нова вкладка')).toBe('new tab')
  })

  it('is the title the main process gives a tab without one', () => {
    expect(normalizeTabTitle('')).toBe(UNTITLED_TAB_TITLE)
    expect(normalizeTabTitle('  ', '')).toBe(UNTITLED_TAB_TITLE)
  })
})
