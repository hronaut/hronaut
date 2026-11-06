import { describe, expect, it } from 'vitest'
import type { BrowserState, BrowserTabState } from '../../src/shared/types.js'
import { guessTabMuted, guessTabSelected, guessTabsMoved } from '../../src/renderer/src/stores/browser-state-guesses.js'

function tab(id: string, fields: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    title: id,
    url: `https://${id}.example/`,
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: false,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...fields
  }
}

function state(tabs: BrowserTabState[], activeTabId: string | null = tabs.find((candidate) => candidate.active)?.id ?? null): BrowserState {
  return {
    tabs,
    closedTabs: [],
    activeTabId,
    allHumanInteractionLocked: false,
    mcpUrl: '',
    profilePath: '',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

const ids = (next: BrowserState) => next.tabs.map((candidate) => candidate.id)

describe('guesses of tab actions', () => {
  it('selects a tab: it becomes the active one and the tab shown before no longer is, the others keep their objects', () => {
    const before = state([tab('a', { active: true }), tab('b'), tab('c')])
    const after = guessTabSelected('b')(before)
    expect(after.activeTabId).toBe('b')
    expect(after.tabs.map((candidate) => candidate.active)).toEqual([false, true, false])
    expect(after.tabs[2]).toBe(before.tabs[2])
    expect(before.activeTabId).toBe('a')
    expect(before.tabs[0].active).toBe(true)
  })

  it('leaves the state as it is for the tab already shown, a tab that is gone, or one main shows only once it wakes', () => {
    const before = state([tab('a', { active: true }), tab('b'), tab('asleep', { sleeping: true }), tab('waking', { loading: true })])
    expect(guessTabSelected('a')(before)).toBe(before)
    expect(guessTabSelected('closed')(before)).toBe(before)
    expect(guessTabSelected('asleep')(before)).toBe(before)
    expect(guessTabSelected('waking')(before)).toBe(before)
  })

  it('makes the tab its workspace\'s active tab, and puts a split view aside only when the tab is not in it', () => {
    const before: BrowserState = {
      ...state([tab('a', { active: true }), tab('b'), tab('c', { mcpGroupId: 'w' }), tab('d', { mcpGroupId: 'w' })]),
      splitView: { firstTabId: 'a', secondTabId: 'b', orientation: 'vertical', ratio: 0.5 },
      mcpTabGroups: [{ id: 'w', name: 'Work', activeTabId: 'c' } as BrowserState['mcpTabGroups'][number]]
    }
    const inSplit = guessTabSelected('b')(before)
    expect(inSplit.splitView).toBe(before.splitView)
    expect(inSplit.mcpTabGroups[0]).toBe(before.mcpTabGroups[0])
    const outside = guessTabSelected('d')(before)
    expect(outside.splitView).toBeUndefined()
    expect(outside.restingSplitViews).toEqual([before.splitView])
    expect(outside.mcpTabGroups[0].activeTabId).toBe('d')
    expect(before.mcpTabGroups[0].activeTabId).toBe('c')
  })

  it('shows a split view put aside again when either of its tabs is selected, as main does', () => {
    const shown = { firstTabId: 'a', secondTabId: 'b', orientation: 'vertical' as const, ratio: 0.5 }
    const aside = { firstTabId: 'c', secondTabId: 'd', orientation: 'horizontal' as const, ratio: 0.3 }
    const before: BrowserState = {
      ...state([tab('a', { active: true }), tab('b'), tab('c'), tab('d'), tab('e')]),
      splitView: shown,
      restingSplitViews: [aside]
    }
    const paired = guessTabSelected('d')(before)
    expect(paired.activeTabId).toBe('d')
    expect(paired.splitView).toBe(aside)
    expect(paired.restingSplitViews).toEqual([shown])

    const alone = guessTabSelected('e')(before)
    expect(alone.splitView).toBeUndefined()
    expect(alone.restingSplitViews).toEqual([aside, shown])

    // A pair whose other tab shows Home, or is gone, ends, so the tab shows alone.
    const home: BrowserState = { ...before, tabs: before.tabs.map((candidate) => candidate.id === 'c' ? { ...candidate, url: 'hronaut://home/' } : candidate) }
    const ended = guessTabSelected('d')(home)
    expect(ended.splitView).toBeUndefined()
    expect(ended.restingSplitViews).toEqual([shown])
    const gone = guessTabSelected('d')({ ...before, tabs: before.tabs.filter((candidate) => candidate.id !== 'c') })
    expect(gone.splitView).toBeUndefined()
    expect(gone.restingSplitViews).toEqual([shown])
  })

  it('mutes a tab or turns its sound back on, and leaves a tab already so or gone alone', () => {
    const before = state([tab('a', { active: true }), tab('b')])
    const muted = guessTabMuted('b', true)(before)
    expect(muted.tabs[1].muted).toBe(true)
    expect(muted.tabs[0]).toBe(before.tabs[0])
    expect(guessTabMuted('b', false)(muted).tabs[1].muted).toBe(false)
    expect(guessTabMuted('b', false)(before)).toBe(before)
    expect(guessTabMuted('closed', true)(before)).toBe(before)
  })

  it('moves tabs before or after the target, in the order they have, as main moves them', () => {
    const before = state([tab('a', { active: true }), tab('b'), tab('c'), tab('d')])
    expect(ids(guessTabsMoved(['a'], 'c', 'after')(before))).toEqual(['b', 'c', 'a', 'd'])
    expect(ids(guessTabsMoved(['d'], 'a', 'before')(before))).toEqual(['d', 'a', 'b', 'c'])
    expect(ids(guessTabsMoved(['d', 'a'], 'b', 'after')(before))).toEqual(['b', 'a', 'd', 'c'])
    expect(guessTabsMoved(['a'], 'b', 'before')(before)).toBe(before)
  })

  it('makes no move main refuses: across workspaces, across the pinned boundary, Home, onto a moving tab, or a tab that is gone', () => {
    const home = tab('home', { url: 'hronaut://home/' })
    const before = state([
      home,
      tab('pinned', { pinned: true }),
      tab('a', { active: true }),
      tab('b'),
      tab('agent', { mcpGroupId: 'workspace' })
    ])
    expect(guessTabsMoved(['a'], 'agent', 'after')(before)).toBe(before)
    expect(guessTabsMoved(['a'], 'pinned', 'before')(before)).toBe(before)
    expect(guessTabsMoved(['home'], 'b', 'after')(before)).toBe(before)
    expect(guessTabsMoved(['a'], 'home', 'after')(before)).toBe(before)
    expect(guessTabsMoved(['a', 'b'], 'b', 'after')(before)).toBe(before)
    expect(guessTabsMoved(['closed'], 'b', 'after')(before)).toBe(before)
    expect(guessTabsMoved(['a'], 'closed', 'after')(before)).toBe(before)
  })
})
