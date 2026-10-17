import { describe, expect, it } from 'vitest'
import type { AgentPresence } from '../src/shared/agent-presence.js'
import type { BrowserSavedTabGroupState, BrowserTabGroupState } from '../src/shared/types.js'
import {
  filterWorkspaceSwitcherEntries,
  workspaceSiteHost,
  workspaceSwitcherEntries,
  type WorkspaceSwitcherSource
} from '../src/shared/workspace-switcher.js'

function group(id: string, name: string, lastUsedAt: string, extra: Partial<BrowserTabGroupState> = {}): BrowserTabGroupState {
  return {
    id,
    name,
    description: '',
    color: 'blue',
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt,
    tabCount: 1,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    ...extra
  }
}

function archived(id: string, name: string, savedAt: string, urls: string[] = []): BrowserSavedTabGroupState {
  return {
    id,
    name,
    description: '',
    color: 'green',
    savedAt,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    tabs: urls.map((url) => ({ title: url, url, pinned: false }))
  }
}

function agent(name: string, state: AgentPresence['state']): AgentPresence {
  return { clientKey: name, name, initial: name[0] ?? '', colorIndex: 0, state, step: 'working', recentSteps: [] }
}

function source(): WorkspaceSwitcherSource {
  return {
    activeTabId: 'shop-1',
    tabs: [
      { id: 'shop-1', url: 'https://www.shop.example/cart', mcpGroupId: 'shop' },
      { id: 'shop-2', url: 'https://shop.example/checkout', mcpGroupId: 'shop' },
      { id: 'shop-3', url: 'http://localhost:5173/', mcpGroupId: 'shop' },
      { id: 'docs-1', url: 'https://docs.example/start', mcpGroupId: 'docs' },
      { id: 'blog-1', url: 'hronaut://home/', mcpGroupId: 'blog' },
      { id: 'ops-1', url: 'https://grafana.example/d/1', mcpGroupId: 'ops' }
    ],
    mcpTabGroups: [
      group('shop', 'Shop', '2026-10-16T20:00:00.000Z', { tabCount: 3 }),
      group('docs', 'Docs site', '2026-10-16T18:00:00.000Z'),
      group('blog', 'Blog', '2026-10-16T19:00:00.000Z', { description: 'Marketing posts' }),
      group('ops', 'Ops', '2026-10-16T10:00:00.000Z', { navigationPolicy: { mode: 'restricted', rules: ['https://*.grafana.example'] } })
    ],
    savedTabGroups: [
      archived('old', 'Old client', '2026-09-01T00:00:00.000Z', ['https://old.example/a', 'https://old.example/b']),
      archived('older', 'Older client', '2026-08-01T00:00:00.000Z')
    ]
  }
}

describe('workspace switcher entries', () => {
  it('lists workspaces that need you, then where an agent works, then by recent use, and archived ones last', () => {
    const entries = workspaceSwitcherEntries(
      source(),
      { ops: [agent('Codex', 'working'), agent('Claude Code', 'working'), agent('Cursor', 'idle')], docs: [agent('Claude Code', 'idle')] },
      { tabId: 'blog-1' },
      'Agent'
    )

    expect(entries.map((entry) => entry.id)).toEqual(['blog', 'ops', 'shop', 'docs', 'old', 'older'])
    expect(entries.map((entry) => entry.status)).toEqual(['needs-you', 'working', 'idle', 'idle', 'idle', 'idle'])
    expect(entries.find((entry) => entry.id === 'ops')).toMatchObject({
      workingAgents: ['Codex', 'Claude Code'],
      agents: ['Codex', 'Claude Code', 'Cursor']
    })
    expect(entries.find((entry) => entry.id === 'shop')).toMatchObject({
      current: true,
      tabCount: 3,
      // Hosts once each, in tab order, without www; Hronaut's own pages are not sites.
      sites: ['shop.example', 'localhost:5173']
    })
    expect(entries.find((entry) => entry.id === 'blog')?.sites).toEqual([])
    expect(entries.find((entry) => entry.id === 'old')).toMatchObject({ kind: 'archived', tabCount: 2, sites: ['old.example'], current: false })
  })

  it('lists pinned workspaces after those that need you or where an agent works, in the order they were pinned', () => {
    const pinned = source()
    pinned.mcpTabGroups = pinned.mcpTabGroups.map((workspace) => workspace.id === 'docs'
      ? { ...workspace, pinnedAt: '2026-10-17T01:00:00.000Z' }
      : workspace.id === 'ops' ? { ...workspace, pinnedAt: '2026-10-17T00:30:00.000Z' } : workspace)
    const entries = workspaceSwitcherEntries(pinned, {}, { tabId: 'blog-1' }, 'Agent')
    // Ops and Docs were used before Shop, so recent use alone would list them after it.
    expect(entries.map((entry) => entry.id)).toEqual(['blog', 'ops', 'docs', 'shop', 'old', 'older'])
    expect(entries.map((entry) => entry.pinnedAt > 0)).toEqual([false, true, true, false, false, false])
    // An agent working there still comes first.
    const working = workspaceSwitcherEntries(pinned, { shop: [agent('Claude Code', 'working')] }, null, 'Agent')
    expect(working.map((entry) => entry.id)).toEqual(['shop', 'ops', 'docs', 'blog', 'old', 'older'])
  })

  it('takes needs you from a request without a tab, or from an agent waiting there, and names an unnamed agent', () => {
    const fromWorkspace = workspaceSwitcherEntries(source(), {}, { workspaceId: 'docs' }, 'Agent')
    expect(fromWorkspace[0]).toMatchObject({ id: 'docs', status: 'needs-you' })

    const fromAgent = workspaceSwitcherEntries(source(), { ops: [agent('', 'needs-you')] }, null, 'Agent')
    expect(fromAgent[0]).toMatchObject({ id: 'ops', status: 'needs-you', agents: ['Agent'], workingAgents: [] })
  })

  it('finds workspaces by name, description, agent, site and allowed site, with every word matching', () => {
    const entries = workspaceSwitcherEntries(source(), { ops: [agent('Claude Code', 'working')] }, null, 'Agent')
    const ids = (query: string) => filterWorkspaceSwitcherEntries(entries, query).map((entry) => entry.id)

    expect(ids('')).toEqual(entries.map((entry) => entry.id))
    expect(ids('claude')).toEqual(['ops'])
    expect(ids('localhost')).toEqual(['shop'])
    expect(ids('grafana')).toEqual(['ops'])
    expect(ids('marketing')).toEqual(['blog'])
    expect(ids('old.example')).toEqual(['old'])
    expect(ids('claude ops')).toEqual(['ops'])
    expect(ids('claude shop')).toEqual([])
    expect(ids('   ')).toEqual(entries.map((entry) => entry.id))
  })

  it('puts the best name matches first among open workspaces and keeps archived ones below them', () => {
    const entries = workspaceSwitcherEntries({
      activeTabId: null,
      tabs: [],
      mcpTabGroups: [
        group('a', 'Client portal', '2026-10-16T20:00:00.000Z'),
        group('b', 'The client', '2026-10-16T19:00:00.000Z'),
        group('c', 'Client', '2026-10-16T18:00:00.000Z'),
        group('d', 'Subclients', '2026-10-16T17:00:00.000Z')
      ],
      savedTabGroups: [archived('e', 'Client', '2026-10-16T21:00:00.000Z')]
    }, {}, null, 'Agent')

    expect(filterWorkspaceSwitcherEntries(entries, 'Client').map((entry) => entry.id)).toEqual(['c', 'a', 'b', 'd', 'e'])
  })

  it('knows a site only by an http or https address', () => {
    expect(workspaceSiteHost('https://www.example.com/a?b=c')).toBe('example.com')
    expect(workspaceSiteHost('http://127.0.0.1:8080/')).toBe('127.0.0.1:8080')
    expect(workspaceSiteHost('about:blank')).toBeUndefined()
    expect(workspaceSiteHost('file:///tmp/a.html')).toBeUndefined()
    expect(workspaceSiteHost('not a url')).toBeUndefined()
  })
})
