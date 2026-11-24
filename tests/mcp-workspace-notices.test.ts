import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'
import type { BrowserState } from '../src/shared/types.js'
import { createWorkspaceNotices } from '../src/main/mcp/workspace-notices.js'

// An agent working in one tab did not hear that another tab of its workspace showed a dialog, crashed or was handed
// back: it found out only when a later call there failed or hung. The next result in the workspace now says so, once.

const workspaceId = 'ws'
const tab = (id: string, extra: Partial<BrowserState['tabs'][number]> = {}) => ({
  id, title: `Title ${id}`, url: `https://shop.example/${id}?session=query-canary`, loading: false, navigationGeneration: 1, documentGeneration: 1,
  canGoBack: false, canGoForward: false, active: false, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: false,
  zoomPercent: 100, audible: false, muted: false, devToolsOpen: false, mcpGroupId: workspaceId, ...extra
}) as BrowserState['tabs'][number]
const state = (tabs: BrowserState['tabs']) => ({ tabs }) as BrowserState
const result = (): CallToolResult => ({ content: [{ type: 'text', text: '{"ok":true}' }] })
const notes = (value: CallToolResult) => value.content.slice(1).map(item => item.type === 'text' ? item.text : '').join('\n')
const allowAll = () => undefined

describe('workspace notices', () => {
  it('reports a dialog in another tab once, and leaves the call\'s own tab dialog to its own note', () => {
    const notices = createWorkspaceNotices()
    const tabs = [
      tab('own', { dialog: { id: 'd-own', type: 'confirm', message: 'Own?', url: 'https://shop.example/own' } }),
      tab('other', { dialog: { id: 'd-other', type: 'alert', message: 'Saved "draft"', url: 'https://shop.example/other' } })
    ]
    const options = { workspaceId, resolvedTabId: 'own', omitUrlDetail: false, requireActiveCapabilityDispatch: allowAll }
    const first = notes(notices.withNotices(result(), state(tabs), options))
    expect(first).toContain('Tab other ("Title other") shows a website alert: "Saved \\"draft\\""')
    expect(first).toContain('dialogId "d-other"')
    expect(first).not.toContain('d-own')
    expect(notices.withNotices(result(), state(tabs), options).content).toHaveLength(1)
    // The other tab's dialog is now the call's own: still not repeated.
    expect(notices.withNotices(result(), state(tabs), { ...options, resolvedTabId: 'other' }).content).toHaveLength(1)
  })

  it('reports a crash and a hang once each, and a new crash after the page loaded again', () => {
    const notices = createWorkspaceNotices()
    const options = { workspaceId, resolvedTabId: 'own', omitUrlDetail: false, requireActiveCapabilityDispatch: allowAll }
    const crashed = (generation: number) => tab('other', { navigationGeneration: generation,
      pageProblem: { kind: 'renderer-gone', title: 'x', message: 'x', url: 'https://shop.example/other', reason: 'crashed', exitCode: 11 } })
    expect(notes(notices.withNotices(result(), state([tab('own'), crashed(1)]), options)))
      .toBe('Meanwhile in this workspace:\n- Tab other ("Title other"): its page stopped working (crashed, exit code 11). '
        + 'Reload it with browser_history action "reload", or close it with browser_close_tab.')
    expect(notices.withNotices(result(), state([tab('own'), crashed(1)]), options).content).toHaveLength(1)
    expect(notes(notices.withNotices(result(), state([tab('own'), crashed(2)]), options))).toContain('stopped working')
    const hung = tab('third', { pageProblem: { kind: 'unresponsive', title: 'x', message: 'x', url: 'https://shop.example/third' } })
    expect(notes(notices.withNotices(result(), state([tab('own'), hung]), options))).toContain('Tab third ("Title third"): its page stopped responding.')
    // A page that could not load is in that tab's own results, not news from elsewhere.
    const failed = tab('fourth', { pageProblem: { kind: 'load-error', title: 'x', message: 'x', url: 'https://shop.example/fourth' } })
    expect(notices.withNotices(result(), state([failed]), options).content).toHaveLength(1)
  })

  it('reports a hand back with the note agents may read, also for the call\'s own tab', () => {
    const notices = createWorkspaceNotices()
    const handedBack = { at: 5, note: 'The page moved from https://shop.example/a?session=query-canary to https://shop.example/b.',
      noteWithoutUrlDetail: 'The page moved from https://shop.example/a to https://shop.example/b.' }
    const shown = notes(notices.withNotices(result(), state([tab('own', { handedBack, title: '' })]),
      { workspaceId, resolvedTabId: 'own', omitUrlDetail: true, requireActiveCapabilityDispatch: allowAll }))
    expect(shown).toContain('Tab own ("https://shop.example/own"): The page moved from https://shop.example/a to https://shop.example/b.')
    expect(shown).not.toContain('query-canary')
    expect(notices.withNotices(result(), state([tab('own', { handedBack })]),
      { workspaceId, resolvedTabId: 'own', omitUrlDetail: true, requireActiveCapabilityDispatch: allowAll }).content).toHaveLength(1)
    // A later hand back of the same tab is news again.
    expect(notes(notices.withNotices(result(), state([tab('own', { handedBack: { ...handedBack, at: 6 } })]),
      { workspaceId, resolvedTabId: 'own', omitUrlDetail: false, requireActiveCapabilityDispatch: allowAll }))).toContain('query-canary')
  })

  it('keeps an event of a tab the agent may not list for a later call that may', () => {
    const notices = createWorkspaceNotices()
    const tabs = [tab('other', { dialog: { id: 'd', type: 'alert', message: 'Hi', url: 'https://shop.example/other' } })]
    const denied = { workspaceId, resolvedTabId: undefined, omitUrlDetail: false, requireActiveCapabilityDispatch: () => { throw new Error('denied') } }
    expect(notices.withNotices(result(), state(tabs), denied).content).toHaveLength(1)
    expect(notes(notices.withNotices(result(), state(tabs), { ...denied, requireActiveCapabilityDispatch: allowAll }))).toContain('shows a website alert')
  })
})
