// @vitest-environment jsdom
// Redesign QA for #873: the Live activity column beside the workspace cards. Runs of identical steps, stable row
// keys, keyboard focus through rebuilds, the empty state, unloaded workspaces, the request that still waits for you,
// and the shared workspace action path with its pending guard.
import { describe, expect, it, vi } from 'vitest'
import type { HomeDashboard, HomeFeedEntry, HomeWorkspaceActivity, HronautHomeApi } from '../src/shared/home.js'
import type { HomeWorkspaceState } from '../src/shared/home-workspaces.js'
import {
  agent, archivedWorkspace, baseDashboard, byId, deferred, emptyWorkspaces, feedEntry, flush, installHomeHooks,
  isoMinutesAgo, minutesAgo, mountTestHome, openWorkspace, query, words
} from './qa-home-harness.js'

installHomeHooks()

const shop = openWorkspace('shop', { name: 'Acme Store', lastUsedAt: isoMinutesAgo(10) })
const docs = openWorkspace('docs', { name: 'Docs', lastUsedAt: isoMinutesAgo(20) })
const inventory = (overrides: Partial<HomeWorkspaceState> = {}): HomeWorkspaceState => ({ ...emptyWorkspaces, mcpTabGroups: [shop, docs], ...overrides })
const entry = (id: string, workspaceId: string, overrides: Partial<HomeFeedEntry> = {}): HomeFeedEntry => feedEntry(workspaceId, { id, ...overrides })
const live = (feed: HomeFeedEntry[], overrides: Partial<HomeDashboard> = {}): HomeDashboard => ({ ...baseDashboard, feed, ...overrides })

const rows = (): HTMLLIElement[] => [...byId('live-activity-list').querySelectorAll<HTMLLIElement>(':scope > li')]
const keys = (): string[] => rows().map(row => row.dataset.feedId ?? '')
const row = (key: string): HTMLLIElement => query(`#live-activity-list > li[data-feed-id="${key}"]`)
const say = (item: HTMLElement) => ({
  step: words(item.querySelector('.feed-step')),
  note: item.querySelector('.feed-note') ? words(item.querySelector('.feed-note')) : null,
  meta: words(item.querySelector('.feed-meta'))
})

async function mountFeed(feed: HomeFeedEntry[], options: { workspaces?: HomeWorkspaceState; dashboard?: Partial<HomeDashboard>; workspaceAction?: HronautHomeApi['workspaceAction'] } = {}) {
  const home = mountTestHome({
    workspaces: options.workspaces ?? inventory(),
    dashboard: live(feed, options.dashboard),
    api: options.workspaceAction ? { workspaceAction: options.workspaceAction } : {}
  })
  await flush()
  return home
}

describe('Live activity rows (#873)', () => {
  it('shows each finished step in plain words with its agent, workspace and when', async () => {
    await mountFeed([
      entry('b', 'shop', { step: 'click', target: 'Review order', at: minutesAgo(2) }),
      entry('a', 'docs', { agentKey: 'codex', agentName: 'Codex', step: 'read', at: minutesAgo(120) })
    ])
    expect(say(row('b'))).toEqual({ step: 'Clicked “Review order”', note: null, meta: 'Claude Code · Acme Store · 2 minutes ago' })
    expect(say(row('a'))).toEqual({ step: 'Read the page', note: null, meta: 'Codex · Docs · 2 hours ago' })
    const open = query<HTMLButtonElement>('button.feed-open', row('b'))
    expect(open.dataset.workspaceAction).toBe('open')
    expect(open.dataset.workspaceId).toBe('shop')
    expect(open.title).toBe('Open Acme Store')
    expect(words(byId('live-activity-title'))).toBe('Live activity')
    expect(words(query('#live-activity .live-local'))).toBe('Local only')
  })

  it('says a failed step in words, not only by its color', async () => {
    await mountFeed([
      entry('b', 'shop', { step: 'click', target: 'Pay', outcome: 'failed' }),
      entry('a', 'shop', { step: 'navigate', target: 'shop.example/cart' })
    ])
    expect(say(row('b')).step).toBe('Clicked “Pay”, failed')
    expect(row('b').classList.contains('failed')).toBe(true)
    expect(say(row('a')).step).toBe('Opened shop.example/cart')
    expect(row('a').classList.contains('failed')).toBe(false)
  })

  it('groups back-to-back identical steps once, with how many times, keyed by the oldest', async () => {
    await mountFeed([
      entry('e3', 'shop', { step: 'click', target: 'Add' }),
      entry('e2', 'shop', { step: 'click', target: 'Add' }),
      entry('e1', 'shop', { step: 'click', target: 'Add' }),
      entry('e0', 'docs', { step: 'read' })
    ])
    expect(keys()).toEqual(['e1', 'e0'])
    expect(say(row('e1'))).toMatchObject({ step: 'Clicked “Add”', note: '3 times' })
    expect(say(row('e0')).note).toBeNull()
  })

  it.each<{ name: string; second: Partial<HomeFeedEntry> }>([
    { name: 'another agent', second: { agentKey: 'codex', agentName: 'Codex' } },
    { name: 'another workspace', second: { workspaceId: 'docs' } },
    { name: 'another target', second: { target: 'Remove' } },
    { name: 'another kind of step', second: { step: 'hover' } },
    { name: 'another outcome', second: { outcome: 'failed' } }
  ])('keeps steps apart that differ by $name', async ({ second }) => {
    await mountFeed([entry('b', 'shop', { step: 'click', target: 'Add', ...second }), entry('a', 'shop', { step: 'click', target: 'Add' })])
    expect(keys()).toEqual(['b', 'a'])
    expect(rows().some(item => item.querySelector('.feed-note'))).toBe(false)
  })

  it('keeps identical steps apart when another step comes between them', async () => {
    await mountFeed([entry('c', 'shop', { step: 'click', target: 'Add' }), entry('b', 'shop', { step: 'read' }), entry('a', 'shop', { step: 'click', target: 'Add' })])
    expect(keys()).toEqual(['c', 'b', 'a'])
  })

  it('keeps a run\'s key and place while newer repeats join it, and keeps other rows as they are', async () => {
    const home = await mountFeed([entry('a', 'shop', { step: 'click', target: 'Add' }), entry('z', 'docs', { step: 'read', at: minutesAgo(5) })])
    const other = row('z')
    home.show(live([entry('b', 'shop', { step: 'click', target: 'Add' }), entry('a', 'shop', { step: 'click', target: 'Add' }), entry('z', 'docs', { step: 'read', at: minutesAgo(5) })]))
    expect(keys()).toEqual(['a', 'z'])
    expect(say(row('a')).note).toBe('2 times')
    expect(row('z')).toBe(other)
    // A newer, different step goes on top; the rows below move down unchanged.
    const run = row('a')
    home.show(live([entry('n', 'docs', { step: 'scroll' }), entry('b', 'shop', { step: 'click', target: 'Add' }), entry('a', 'shop', { step: 'click', target: 'Add' }), entry('z', 'docs', { step: 'read', at: minutesAgo(5) })]))
    expect(keys()).toEqual(['n', 'a', 'z'])
    expect(row('a')).toBe(run)
    expect(row('z')).toBe(other)
  })

  it('moves times on with each read without rebuilding a row', async () => {
    const feed = [entry('a', 'shop', { at: minutesAgo(1) })]
    const home = await mountFeed(feed)
    const item = row('a')
    expect(say(item).meta).toBe('Claude Code · Acme Store · 1 minute ago')
    vi.setSystemTime(minutesAgo(-5))
    home.show(live(feed, { totalRequests: 1 }))
    expect(row('a')).toBe(item)
    expect(say(item).meta).toBe('Claude Code · Acme Store · 6 minutes ago')
  })

  it('merges the runs around a workspace main forgot', async () => {
    const home = await mountFeed([entry('c', 'shop', { step: 'click', target: 'Add' }), entry('b', 'docs', { step: 'read' }), entry('a', 'shop', { step: 'click', target: 'Add' })])
    expect(keys()).toEqual(['c', 'b', 'a'])
    home.setWorkspaces(inventory({ mcpTabGroups: [shop] }))
    home.show(live([entry('c', 'shop', { step: 'click', target: 'Add' }), entry('a', 'shop', { step: 'click', target: 'Add' })]))
    await flush()
    expect(keys()).toEqual(['a'])
    expect(say(row('a'))).toMatchObject({ step: 'Clicked “Add”', note: '2 times' })
  })

  it('merges the runs around a workspace that is no longer open, before main forgets its steps', async () => {
    const feed = [entry('c', 'shop', { step: 'click', target: 'Add' }), entry('b', 'docs', { step: 'read' }), entry('a', 'shop', { step: 'click', target: 'Add' })]
    const home = await mountFeed(feed)
    home.setWorkspaces(inventory({ mcpTabGroups: [shop], savedTabGroups: [archivedWorkspace(docs)] }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(keys()).toEqual(['a'])
    expect(say(row('a')).note).toBe('2 times')
  })
})

describe('Live activity keyboard focus (#873)', () => {
  it('stays on a run whose row is rebuilt for a new repeat', async () => {
    const home = await mountFeed([entry('a', 'shop', { step: 'click', target: 'Add' }), entry('z', 'docs', { step: 'read' })])
    const before = query<HTMLButtonElement>('button', row('a'))
    before.focus()
    home.show(live([entry('b', 'shop', { step: 'click', target: 'Add' }), entry('a', 'shop', { step: 'click', target: 'Add' }), entry('z', 'docs', { step: 'read' })]))
    expect(query('button', row('a'))).not.toBe(before)
    expect(document.activeElement).toBe(query('button', row('a')))
  })

  it('follows its steps into the merged run when the runs around a forgotten workspace join', async () => {
    const home = await mountFeed([entry('c', 'shop', { step: 'click', target: 'Add' }), entry('b', 'docs', { step: 'read' }), entry('a', 'shop', { step: 'click', target: 'Add' })])
    query<HTMLButtonElement>('button', row('c')).focus()
    home.setWorkspaces(inventory({ mcpTabGroups: [shop] }))
    home.show(live([entry('c', 'shop', { step: 'click', target: 'Add' }), entry('a', 'shop', { step: 'click', target: 'Add' })]))
    expect(keys()).toEqual(['a'])
    expect(document.activeElement).toBe(query('button', row('a')))
  })

  it('follows its steps when the run\'s key changes because its oldest step dropped out', async () => {
    const home = await mountFeed([entry('c', 'shop', { step: 'click', target: 'Add' }), entry('b', 'shop', { step: 'click', target: 'Add' }), entry('a', 'shop', { step: 'click', target: 'Add' }), entry('z', 'docs', { step: 'read' })])
    expect(keys()).toEqual(['a', 'z'])
    query<HTMLButtonElement>('button', row('a')).focus()
    home.show(live([entry('d', 'docs', { step: 'scroll' }), entry('c', 'shop', { step: 'click', target: 'Add' }), entry('b', 'shop', { step: 'click', target: 'Add' })]))
    expect(keys()).toEqual(['d', 'b'])
    expect(document.activeElement).toBe(query('button', row('b')))
  })

  it('moves to the row in the same place when its steps are gone, or to the last row', async () => {
    const home = await mountFeed([entry('c', 'shop', { step: 'read' }), entry('b', 'docs', { step: 'scroll' }), entry('a', 'shop', { step: 'hover' })])
    query<HTMLButtonElement>('button', row('b')).focus()
    home.show(live([entry('c', 'shop', { step: 'read' }), entry('a', 'shop', { step: 'hover' })]))
    expect(keys()).toEqual(['c', 'a'])
    expect(document.activeElement).toBe(query('button', row('a')))
    home.show(live([entry('c', 'shop', { step: 'read' })]))
    expect(document.activeElement).toBe(query('button', row('c')))
  })

  it('never takes focus from outside the column', async () => {
    const home = await mountFeed([entry('a', 'shop', { step: 'read' })])
    const search = byId('workspace-search')
    search.focus()
    home.show(live([entry('b', 'docs', { step: 'click' }), entry('a', 'shop', { step: 'read' })]))
    expect(document.activeElement).toBe(search)
  })
})

describe('Live activity empty state and unloaded workspaces (#873)', () => {
  const isEmpty = () => ({ empty: !byId('live-activity-empty').hidden, list: !byId('live-activity-list').hidden })

  it('says what it is for until an agent works, and comes back when the steps go', async () => {
    const home = await mountFeed([])
    expect(isEmpty()).toEqual({ empty: true, list: false })
    expect(words(byId('live-activity-empty'))).toBe('When an agent works in a workspace, its steps appear here.')
    home.show(live([entry('a', 'shop')]))
    expect(isEmpty()).toEqual({ empty: false, list: true })
    home.show(live([]))
    expect(isEmpty()).toEqual({ empty: true, list: false })
    expect(rows()).toEqual([])
  })

  it('leaves out steps in workspaces Home has not loaded, and shows them once it has', async () => {
    const home = await mountFeed([entry('b', 'later', { step: 'read' }), entry('a', 'archived', { step: 'click' })], {
      workspaces: inventory({ savedTabGroups: [archivedWorkspace(openWorkspace('archived'))] })
    })
    expect(rows()).toEqual([])
    expect(isEmpty()).toEqual({ empty: true, list: false })
    home.setWorkspaces(inventory({ mcpTabGroups: [shop, docs, openWorkspace('later', { name: 'Later' })], savedTabGroups: [archivedWorkspace(openWorkspace('archived'))] }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(keys()).toEqual(['b'])
    expect(say(row('b')).meta).toBe('Claude Code · Later · 1 minute ago')
  })
})

describe('The request that still waits for you (#873)', () => {
  const needsYou = (key: string, ...others: string[]): HomeWorkspaceActivity => ({ state: 'needs-you', agentKeys: [key, ...others], step: 'askYou' })
  const marked = () => rows().filter(item => item.classList.contains('needs-you')).map(item => item.dataset.feedId)

  it('marks only the newest successful request of the agent leading a workspace that needs you, in words too', async () => {
    await mountFeed([
      entry('d', 'shop', { step: 'askYou' }),
      entry('c', 'shop', { step: 'read' }),
      entry('b', 'shop', { step: 'askYou' }),
      entry('a', 'docs', { step: 'askYou' })
    ], { dashboard: { agents: [agent('claude', 'Claude Code', 'needs-you')], workspaceActivity: { shop: needsYou('claude'), docs: { state: 'working', agentKeys: ['claude'], step: 'read' } } } })
    expect(marked()).toEqual(['d'])
    expect(say(row('d'))).toMatchObject({ step: 'Asked for your help', note: 'needs you' })
    expect(say(row('b')).note).toBeNull()
    expect(say(row('a')).note).toBeNull()
  })

  it('never marks a failed request', async () => {
    await mountFeed([entry('b', 'shop', { step: 'askYou', outcome: 'failed' }), entry('a', 'shop', { step: 'askYou' })], {
      dashboard: { workspaceActivity: { shop: needsYou('claude') } }
    })
    expect(row('b').classList.contains('needs-you')).toBe(false)
    expect(say(row('b')).note).toBeNull()
    expect(marked()).toEqual(['a'])
  })

  it('does not mark the request of an agent that does not lead the workspace', async () => {
    await mountFeed([entry('b', 'shop', { step: 'askYou', agentKey: 'codex', agentName: 'Codex' }), entry('a', 'shop', { step: 'askYou' })], {
      dashboard: { workspaceActivity: { shop: needsYou('claude', 'codex') } }
    })
    expect(marked()).toEqual(['a'])
  })

  it('drops the mark once the agent no longer needs you', async () => {
    const feed = [entry('a', 'shop', { step: 'askYou' })]
    const home = await mountFeed(feed, { dashboard: { workspaceActivity: { shop: needsYou('claude') } } })
    expect(marked()).toEqual(['a'])
    home.show(live(feed, { workspaceActivity: { shop: { state: 'working', agentKeys: ['claude'], step: 'click' } } }))
    expect(marked()).toEqual([])
    expect(say(row('a')).note).toBeNull()
  })

  it('says both that it waits and how often it was asked', async () => {
    await mountFeed([entry('b', 'shop', { step: 'askYou' }), entry('a', 'shop', { step: 'askYou' })], { dashboard: { workspaceActivity: { shop: needsYou('claude') } } })
    expect(keys()).toEqual(['a'])
    expect(say(row('a')).note).toBe('needs you · 2 times')
  })
})

describe('Live activity avatars (#873)', () => {
  it('uses the connected agent\'s initial, else the first character of its name, else the unnamed agent\'s', async () => {
    await mountFeed([
      entry('c', 'shop', { agentKey: 'claude', agentName: 'Claude Code' }),
      entry('b', 'shop', { agentKey: 'bot', agentName: '🤖 helper', step: 'read' }),
      entry('a', 'shop', { agentKey: 'blank', agentName: '  ', step: 'hover' })
    ], { dashboard: { agents: [agent('claude', 'Claude Code', 'idle', { initial: 'Q' })] } })
    expect(['c', 'b', 'a'].map(key => query('.feed-avatar', row(key)).textContent)).toEqual(['Q', '🤖', 'A'])
    expect(say(row('a')).meta).toBe('Agent · Acme Store · 1 minute ago')
    for (const key of ['c', 'b', 'a']) expect(query('.feed-avatar', row(key)).getAttribute('aria-hidden')).toBe('true')
  })
})

describe('Live activity actions (#873)', () => {
  it('opens a row\'s workspace through the workspace action', async () => {
    const workspaceAction = vi.fn().mockResolvedValue(inventory())
    await mountFeed([entry('a', 'docs')], { workspaceAction })
    query<HTMLButtonElement>('button', row('a')).click()
    await flush()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'open', workspaceId: 'docs' })
  })

  it('disables every row, including one that arrives meanwhile, while a workspace action is pending', async () => {
    const pending = deferred<HomeWorkspaceState>()
    const workspaceAction = vi.fn().mockReturnValue(pending.promise)
    const home = await mountFeed([entry('b', 'shop', { step: 'read' }), entry('a', 'docs', { step: 'click' })], { workspaceAction })
    query<HTMLButtonElement>('button', row('b')).click()
    expect(workspaceAction).toHaveBeenCalledTimes(1)
    expect(byId('home-workspaces').getAttribute('aria-busy')).toBe('true')
    expect(rows().map(item => query<HTMLButtonElement>('button', item).disabled)).toEqual([true, true])
    // A second choice while the first is pending does nothing.
    query<HTMLButtonElement>('button', row('a')).click()
    expect(workspaceAction).toHaveBeenCalledTimes(1)
    home.show(live([entry('c', 'docs', { step: 'scroll' }), entry('b', 'shop', { step: 'read' }), entry('a', 'docs', { step: 'click' })]))
    expect(rows().map(item => query<HTMLButtonElement>('button', item).disabled)).toEqual([true, true, true])

    pending.resolve(inventory())
    await flush()
    expect(byId('home-workspaces').getAttribute('aria-busy')).toBe('false')
    expect(rows().map(item => query<HTMLButtonElement>('button', item).disabled)).toEqual([false, false, false])
    query<HTMLButtonElement>('button', row('c')).click()
    expect(workspaceAction).toHaveBeenLastCalledWith({ view: 'open', workspaceId: 'docs' })
  })

  it('only closes an open card menu on a row click, without opening the row\'s workspace', async () => {
    const workspaceAction = vi.fn().mockResolvedValue(inventory())
    await mountFeed([entry('a', 'docs')], { workspaceAction })
    const menu = query<HTMLDetailsElement>('.home-workspace-card .card-menu')
    menu.open = true
    query<HTMLButtonElement>('button', row('a')).click()
    await flush()
    expect(menu.open).toBe(false)
    expect(workspaceAction).not.toHaveBeenCalled()
    query<HTMLButtonElement>('button', row('a')).click()
    await flush()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'open', workspaceId: 'docs' })
  })
})
