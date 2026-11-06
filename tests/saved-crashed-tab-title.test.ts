import { describe, expect, it, vi } from 'vitest'
import { persistedTab, type PersistedStateTab } from '../src/main/browser/browser-state/persisted-state.js'
import type { BrowserPageProblem } from '../src/shared/types.js'

// A tab whose page could not load is titled Site unavailable. The saved session kept that title, so after a restart the
// tab came back asleep under it, and closing it then listed Site unavailable in Recently closed. Chrome brings it back
// by its page. A tab whose page crashed keeps its page's title, as Chrome's does, and is saved by it.

function tab(changes: Partial<PersistedStateTab>): PersistedStateTab {
  return {
    id: 'tab', title: 'Inbox (3)', url: 'https://mail.example/inbox', pinned: false, tabMuted: false, humanInteractionLocked: false,
    tabAgentPaused: false, zoomIsolated: false, ...changes
  }
}

describe('the title the saved session keeps a tab by', () => {
  it('is its address as Chromium shows it when its page could not load', () => {
    const failed: BrowserPageProblem = { kind: 'load-error', title: 'Site unavailable', message: 'Unreachable.', url: '' }
    const untitled = () => ({ entries: [{ url: 'https://mail.example/inbox', title: 'mail.example/inbox' }], index: 0 })
    expect(persistedTab(tab({ title: 'Site unavailable', pageProblem: failed }), untitled).title).toBe('https://mail.example/inbox')
  })

  it('is its title otherwise, without reading its history', () => {
    const history = vi.fn(() => ({ entries: [], index: -1 }))
    expect(persistedTab(tab({}), history).title).toBe('Inbox (3)')
    const hung: BrowserPageProblem = { kind: 'unresponsive', title: 'Page not responding', message: 'Wait or close it.', url: '' }
    expect(persistedTab(tab({ pageProblem: hung }), history).title).toBe('Inbox (3)')
    const crashed: BrowserPageProblem = { kind: 'renderer-gone', title: 'This page stopped working', message: 'The page stopped.', url: '', reason: 'crashed' }
    expect(persistedTab(tab({ pageProblem: crashed }), history).title).toBe('Inbox (3)')
    expect(history).not.toHaveBeenCalled()
  })
})
