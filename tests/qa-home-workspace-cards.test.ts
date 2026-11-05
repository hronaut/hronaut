// @vitest-environment jsdom
// Redesign QA for #872 and HRO-65: each workspace card's live status and its in-place update, the card menu, the tab
// tiles, the header, the Agents view, the needs-you line, and Undo after archive and clear. The connected agents list
// has its own file.
import { describe, expect, it, vi } from 'vitest'
import type { HomeDashboard, HomeWorkspaceActivity } from '../src/shared/home.js'
import type { HomeWorkspaceState } from '../src/shared/home-workspaces.js'
import { HOME_CARD_TAB_LIMIT } from '../src/shared/home-workspaces.js'
import {
  agent, archivedWorkspace, baseDashboard, byId, emptyWorkspaces, feedEntry, flush, installHomeHooks, isoMinutesAgo,
  minutesAgo, mountTestHome, openWorkspace, query, words
} from './qa-home-harness.js'

installHomeHooks()

const shop = openWorkspace('shop', { name: 'Acme Store', lastUsedAt: isoMinutesAgo(60) })
const docs = openWorkspace('docs', { name: 'Docs', lastUsedAt: isoMinutesAgo(120) })
const inventory = (overrides: Partial<HomeWorkspaceState> = {}): HomeWorkspaceState => ({ ...emptyWorkspaces, mcpTabGroups: [shop, docs], ...overrides })
const agents = [agent('claude', 'Claude Code', 'needs-you'), agent('codex', 'Codex', 'working'), agent('cursor', 'Cursor', 'idle')]
const activity = (state: HomeWorkspaceActivity['state'], key: string, step: HomeWorkspaceActivity['step'] = 'read', target?: string): HomeWorkspaceActivity =>
  ({ state, agentKeys: [key], step, ...(target ? { target } : {}) })

const card = (name: string): HTMLElement => query(`.home-workspace-card[aria-label="${name}"]`)
const cardStatus = (name: string) => {
  const line = query('.card-status', card(name))
  return { text: words(line), className: line.className, ring: card(name).classList.contains('needs-you') }
}

describe('Workspace card status kinds (#872)', () => {
  it.each<{ name: string; live: Partial<HomeDashboard>; text: string; tone: string }>([
    { name: 'an agent that needs you', live: { agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } }, text: 'Claude Code needs you', tone: 'needs-you' },
    { name: 'a lead agent Home cannot name', live: { agents: [], workspaceActivity: { shop: activity('needs-you', 'gone', 'askYou') } }, text: 'Agent needs you', tone: 'needs-you' },
    { name: 'a working step without a target', live: { agents, workspaceActivity: { shop: activity('working', 'codex', 'read') } }, text: 'Codex · Reading the page', tone: 'working' },
    { name: 'a working step with its target', live: { agents, workspaceActivity: { shop: activity('working', 'codex', 'click', 'Review order') } }, text: 'Codex · Clicking “Review order”', tone: 'working' },
    {
      name: 'the latest finished step of an idle agent',
      live: { agents, workspaceActivity: { shop: activity('idle', 'cursor', 'openTab') }, feed: [feedEntry('docs', { agentName: 'Codex', step: 'read', at: minutesAgo(1) }), feedEntry('shop', { agentKey: 'cursor', agentName: 'Cursor', step: 'openTab', at: minutesAgo(2) }), feedEntry('shop', { agentKey: 'cursor', agentName: 'Cursor', step: 'read', at: minutesAgo(9) })] },
      text: 'Cursor · Opened a new tab · 2 minutes ago', tone: 'idle'
    },
    {
      name: 'the latest finished step after its agent left',
      live: { agents: [], feed: [feedEntry('shop', { agentName: 'Cursor', step: 'navigate', target: 'shop.example/cart', at: minutesAgo(3) })] },
      text: 'Cursor · Opened shop.example/cart · 3 minutes ago', tone: 'quiet'
    },
    {
      name: 'a failed finished step',
      live: { agents: [], feed: [feedEntry('shop', { agentName: 'Cursor', step: 'click', target: 'Pay', outcome: 'failed', at: minutesAgo(2) })] },
      text: 'Cursor · Clicked “Pay”, failed · 2 minutes ago', tone: 'quiet'
    },
    { name: 'an idle agent with no finished step', live: { agents, workspaceActivity: { shop: activity('idle', 'cursor') } }, text: 'Cursor · Idle', tone: 'idle' },
    { name: 'no agent', live: { agents }, text: 'Last used 1 hour ago', tone: 'quiet' }
  ])('says what $name means on the card', async ({ live, text, tone }) => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, ...live } })
    await flush()
    expect(cardStatus('Acme Store')).toEqual({ text, className: `card-status ${tone}`, ring: tone === 'needs-you' })
    // Another workspace's agents never speak on this card.
    expect(cardStatus('Docs').ring).toBe(false)
  })

  it('says when an archived workspace was last used and never shows agents on it', async () => {
    const archived = archivedWorkspace(shop, isoMinutesAgo(5))
    mountTestHome({
      workspaces: inventory({ mcpTabGroups: [docs], savedTabGroups: [archived] }),
      dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } }
    })
    await flush()
    byId<HTMLButtonElement>('workspaces-archived').click()
    expect(cardStatus('Acme Store')).toEqual({ text: 'Last used 5 minutes ago', className: 'card-status quiet', ring: false })
  })

  it('updates only the status line and ring as an agent moves on, keeping the card, its controls and focus', async () => {
    const home = mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('working', 'codex', 'read') } } })
    await flush()
    const node = card('Acme Store')
    const children = [...node.children]
    const open = query<HTMLButtonElement>('[data-workspace-action="open"]', node)
    open.focus()
    const observer = new MutationObserver(() => {})
    observer.observe(node, { childList: true, subtree: true, characterData: true, attributes: true })

    home.show({ ...baseDashboard, agents, workspaceActivity: { shop: activity('working', 'codex', 'click', 'Checkout') } })
    expect(cardStatus('Acme Store')).toEqual({ text: 'Codex · Clicking “Checkout”', className: 'card-status working', ring: false })
    home.show({ ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } })
    expect(cardStatus('Acme Store')).toEqual({ text: 'Claude Code needs you', className: 'card-status needs-you', ring: true })
    home.show({ ...baseDashboard, agents: [] })
    expect(cardStatus('Acme Store')).toEqual({ text: 'Last used 1 hour ago', className: 'card-status quiet', ring: false })

    const changed = observer.takeRecords()
    observer.disconnect()
    expect(card('Acme Store')).toBe(node)
    expect([...node.children]).toEqual(children)
    expect(document.activeElement).toBe(open)
    // Nothing outside the status line and the card's own class changed.
    const statusLine = query('.card-status', node)
    for (const record of changed) expect(record.target === node || statusLine.contains(record.target)).toBe(true)
  })

  it('does not rewrite an unchanged status line on later reads', async () => {
    const live = { ...baseDashboard, agents, workspaceActivity: { shop: activity('working', 'codex', 'read') } }
    const home = mountTestHome({ workspaces: inventory(), dashboard: live })
    await flush()
    const observer = new MutationObserver(() => {})
    observer.observe(card('Acme Store'), { childList: true, subtree: true, characterData: true, attributes: true })
    home.show({ ...live, totalRequests: 9 })
    await vi.advanceTimersByTimeAsync(2000)
    expect(observer.takeRecords()).toEqual([])
    observer.disconnect()
  })
})

describe('Workspace card menu (#872)', () => {
  async function mountWithMenu(workspaceAction = vi.fn().mockResolvedValue(inventory())) {
    const home = mountTestHome({ workspaces: inventory(), api: { workspaceAction } })
    await flush()
    const menu = query<HTMLDetailsElement>('.card-menu', card('Acme Store'))
    menu.open = true
    return { home, menu, workspaceAction, summary: query('summary', menu), open: query<HTMLButtonElement>('[data-workspace-action="open"]', card('Acme Store')) }
  }

  it('names its button after the workspace', async () => {
    const { summary } = await mountWithMenu()
    expect(summary.getAttribute('aria-label')).toBe('More actions for Acme Store')
  })

  it('closes on Escape and gives focus back to its button', async () => {
    const { menu, summary } = await mountWithMenu()
    const manage = query<HTMLButtonElement>('[data-workspace-action="edit"]', menu)
    manage.focus()
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    manage.dispatchEvent(escape)
    expect(menu.open).toBe(false)
    expect(escape.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(summary)
  })

  it('stays open on Escape while an input method is composing', async () => {
    const { menu } = await mountWithMenu()
    const manage = query<HTMLButtonElement>('[data-workspace-action="edit"]', menu)
    manage.focus()
    manage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, isComposing: true }))
    expect(menu.open).toBe(true)
  })

  it('closes on a click on its own card without opening the workspace', async () => {
    const { menu, open, workspaceAction } = await mountWithMenu()
    open.click()
    await flush()
    expect(menu.open).toBe(false)
    expect(workspaceAction).not.toHaveBeenCalled()
    // The next click, with no menu open, opens it.
    open.click()
    await flush()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'open', workspaceId: 'shop' })
  })

  it('closes on a click on another card without opening that workspace', async () => {
    const { menu, workspaceAction } = await mountWithMenu()
    query<HTMLButtonElement>('[data-workspace-action="open"]', card('Docs')).click()
    await flush()
    expect(menu.open).toBe(false)
    expect(workspaceAction).not.toHaveBeenCalled()
  })

  it('closes on a click elsewhere on Home', async () => {
    const { menu } = await mountWithMenu()
    byId('home-view-title').click()
    expect(menu.open).toBe(false)
  })

  it('stays open on a click inside it', async () => {
    const { menu } = await mountWithMenu()
    query('.card-menu-list label', menu).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(menu.open).toBe(true)
  })

  it('closes when keyboard focus leaves it, but not while focus moves inside it', async () => {
    const { menu, summary } = await mountWithMenu()
    summary.focus()
    query<HTMLButtonElement>('[data-workspace-action="edit"]', menu).focus()
    query<HTMLButtonElement>('[data-workspace-action="transfer"]', menu).focus()
    expect(menu.open).toBe(true)
    byId('workspace-search').focus()
    expect(menu.open).toBe(false)
  })

  it('leaves a pointer press to the click: focus moving to the card does not open it either', async () => {
    const { menu, summary, open, workspaceAction } = await mountWithMenu()
    summary.focus()
    open.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    open.focus()
    // Focus left the menu during the press, but the menu waits for the click.
    expect(menu.open).toBe(true)
    open.dispatchEvent(new Event('pointerup', { bubbles: true }))
    open.click()
    await flush()
    expect(menu.open).toBe(false)
    expect(workspaceAction).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    // Once the press is over, focus leaving a menu closes it again.
    menu.open = true
    summary.focus()
    byId('workspace-search').focus()
    expect(menu.open).toBe(false)
  })

  it('keeps one menu open at a time', async () => {
    const { menu } = await mountWithMenu()
    await vi.advanceTimersByTimeAsync(0)
    const other = query<HTMLDetailsElement>('.card-menu', card('Docs'))
    other.open = true
    await vi.advanceTimersByTimeAsync(0)
    expect(other.open).toBe(true)
    expect(menu.open).toBe(false)
  })

  it('closes after one of its actions is chosen and gives focus back to its button', async () => {
    const { menu, summary, workspaceAction } = await mountWithMenu()
    query<HTMLButtonElement>('[data-workspace-action="edit"]', menu).click()
    await flush()
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(summary)
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'edit', workspaceId: 'shop' })
  })
})

describe('Workspace card tab tiles (#872)', () => {
  const tabs = (count: number, start = 0) => Array.from({ length: count }, (_, index) => ({
    id: `tab-${start + index}`, mcpGroupId: 'shop', title: `Page ${start + index + 1}`, url: `https://site${start + index + 1}.example/`
  }))
  const tiles = () => [...card('Acme Store').querySelectorAll<HTMLElement>('.card-tabs > li')]

  it.each([
    { count: 1, shown: 1, more: null },
    { count: HOME_CARD_TAB_LIMIT, shown: HOME_CARD_TAB_LIMIT, more: null },
    { count: HOME_CARD_TAB_LIMIT + 1, shown: HOME_CARD_TAB_LIMIT - 1, more: '+2' },
    { count: 9, shown: HOME_CARD_TAB_LIMIT - 1, more: '+6' }
  ])('shows at most $shown tab tiles of $count tabs, then how many more', async ({ count, shown, more }) => {
    mountTestHome({ workspaces: inventory({ tabs: tabs(count) }) })
    await flush()
    const list = query('.card-tabs', card('Acme Store'))
    expect(list.getAttribute('aria-label')).toBe(count === 1 ? '1 tab' : `${count} tabs`)
    expect(tiles().length).toBeLessThanOrEqual(HOME_CARD_TAB_LIMIT)
    expect(tiles().filter(tile => tile.matches('.card-tab:not(.card-tab-more)')).map(tile => words(tile.querySelector('.card-tab-title'))))
      .toEqual(tabs(shown).map(tab => tab.title))
    expect(card('Acme Store').querySelector('.card-tab-more')?.textContent ?? null).toBe(more)
    expect(words(query('.card-meta', card('Acme Store')))).toBe(`${count === 1 ? '1 tab' : `${count} tabs`} · 0 known websites`)
  })

  it('says a workspace has no open pages yet', async () => {
    mountTestHome({ workspaces: inventory() })
    await flush()
    expect(tiles().map(tile => words(tile))).toEqual(['No open pages yet'])
  })

  it('shows a tab\'s site icon, or else its site\'s initial, title or a dot', async () => {
    const icon = 'data:image/png;base64,iVBORw0KGgo='
    mountTestHome({
      workspaces: inventory({
        tabs: [
          { id: 'a', mcpGroupId: 'shop', title: 'Cart', url: 'https://shop.example.com/cart', faviconDataUrl: icon },
          { id: 'b', mcpGroupId: 'shop', title: '', url: 'https://www.example.org/docs' },
          { id: 'c', mcpGroupId: 'shop', title: 'home page', url: 'hronaut://home' },
          { id: 'd', mcpGroupId: 'shop', title: '', url: 'data:text/plain,notes' },
          { id: 'e', mcpGroupId: 'docs', title: 'Elsewhere', url: 'https://docs.example/' }
        ]
      })
    })
    await flush()
    const [withIcon, bySite, byTitle, byDot, ...rest] = tiles()
    expect(rest).toEqual([])
    const image = query<HTMLImageElement>('img.card-tab-icon', withIcon!)
    expect(image.getAttribute('src')).toBe(icon)
    expect(image.alt).toBe('')
    expect(withIcon!.querySelector('.card-tab-initial')).toBeNull()
    expect(words(withIcon!.querySelector('.card-tab-title'))).toBe('Cart')

    const initial = query('.card-tab-initial', bySite!)
    expect(initial.textContent).toBe('E')
    expect(initial.getAttribute('aria-hidden')).toBe('true')
    expect(bySite!.querySelector('img')).toBeNull()
    expect(words(bySite!.querySelector('.card-tab-title'))).toBe('example.org')

    expect(query('.card-tab-initial', byTitle!).textContent).toBe('H')
    expect(words(byTitle!.querySelector('.card-tab-title'))).toBe('home page')
    expect(query('.card-tab-initial', byDot!).textContent).toBe('·')
    expect(words(byDot!.querySelector('.card-tab-title'))).toBe('data:text/plain,notes')
  })

  // Hronaut calls a blank tab "New tab" until a page names it; that English title showed in every language.
  it.each([
    ['en-US', 'New tab', 'N'],
    ['uk-UA', 'Нова вкладка', 'Н'],
    ['de-DE', 'Neuer Tab', 'N']
  ] as const)('names a blank tab in %s, and keeps a website that calls itself "New tab"', async (locale, name, initial) => {
    mountTestHome({
      locale,
      workspaces: inventory({
        tabs: [
          { id: 'blank', mcpGroupId: 'shop', title: 'New tab', url: 'about:blank' },
          { id: 'untitled', mcpGroupId: 'shop', title: '', url: 'about:blank' },
          { id: 'site', mcpGroupId: 'shop', title: 'New tab', url: 'https://shop.example.com/new' }
        ]
      })
    })
    await flush()
    const [blank, untitled, site] = tiles()
    expect(words(blank!.querySelector('.card-tab-title'))).toBe(name)
    expect(query('.card-tab-initial', blank!).textContent).toBe(initial)
    expect(words(untitled!.querySelector('.card-tab-title'))).toBe(name)
    expect(words(site!.querySelector('.card-tab-title'))).toBe('New tab')
  })
})

describe('One header for every view (HRO-65)', () => {
  it.each([[0, 0], [9, 30], [14, 5], [21, 45]])('names the Workspaces view, never a greeting, at %i:%i local time', async (hour, minute) => {
    vi.setSystemTime(new Date(2026, 8, 13, hour, minute, 0))
    mountTestHome({ workspaces: inventory() })
    await flush()
    expect(words(byId('home-view-title'))).toBe('Workspaces')
  })

  it('names each of the three views', async () => {
    mountTestHome({ workspaces: inventory() })
    await flush()
    expect([...document.querySelectorAll('.home-navigation [role=tab]')].map(words)).toEqual(['Tabs', 'Workspaces', 'Agents'])
    byId<HTMLButtonElement>('home-tab-agents').click()
    expect(words(byId('home-view-title'))).toBe('Agents')
    byId<HTMLButtonElement>('home-tab-tabs').click()
    expect(words(byId('home-view-title'))).toBe('Tabs')
    byId<HTMLButtonElement>('home-tab-workspaces').click()
    expect(words(byId('home-view-title'))).toBe('Workspaces')
  })

  it.each<{ name: string; workspaces: HomeWorkspaceState; summary: string }>([
    { name: 'no workspace', workspaces: emptyWorkspaces, summary: 'Keep projects and sign-ins in separate browser spaces. Pick up where you left off.' },
    { name: 'open workspaces', workspaces: inventory(), summary: '2 open' },
    { name: 'open and archived workspaces', workspaces: inventory({ mcpTabGroups: [docs], savedTabGroups: [archivedWorkspace(shop)] }), summary: '1 open · 1 archived' },
    { name: 'archived workspaces only', workspaces: inventory({ mcpTabGroups: [], savedTabGroups: [archivedWorkspace(shop)] }), summary: '0 open · 1 archived' }
  ])('counts $name under the Workspaces name', async ({ workspaces, summary }) => {
    mountTestHome({ workspaces, dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } } })
    await flush()
    expect(words(byId('home-view-description'))).toBe(summary)
  })

  // One workspace read "1 abiertos" in Spanish.
  it.each([
    ['es-ES', '1 abierto · 1 archivado', '2 abiertos · 2 archivados'],
    ['fr-FR', '1 ouvert · 1 archivé', '2 ouverts · 2 archivés'],
    ['it-IT', '1 aperta · 1 archiviata', '2 aperte · 2 archiviate'],
    ['pt-BR', '1 aberto · 1 arquivado', '2 abertos · 2 arquivados']
  ] as const)('counts one workspace and several in %s', async (locale, one, two) => {
    const archived = (id: string) => archivedWorkspace(openWorkspace(id, { name: `Old ${id}` }))
    const home = mountTestHome({ locale, workspaces: inventory({ mcpTabGroups: [docs], savedTabGroups: [archived('a')] }) })
    await flush()
    expect(words(byId('home-view-description'))).toBe(one)
    home.setWorkspaces(inventory({ savedTabGroups: [archived('a'), archived('b')] }))
    await home.page.refresh()
    await flush()
    expect(words(byId('home-view-description'))).toBe(two)
  })

  it('counts again when a workspace is archived', async () => {
    const home = mountTestHome({ workspaces: inventory() })
    await flush()
    home.setWorkspaces(inventory({ mcpTabGroups: [docs], savedTabGroups: [archivedWorkspace(shop)] }))
    await home.page.refresh()
    await flush()
    expect(words(byId('home-view-description'))).toBe('1 open · 1 archived')
  })

  it.each<{ name: string; live: Partial<HomeDashboard>; summary: string }>([
    { name: 'no agent', live: {}, summary: 'Choose a client, copy the setup, then create a named workspace before browsing.' },
    { name: 'one agent', live: { agents: [agent('a', 'Codex', 'idle')] }, summary: '1 agent connected.' },
    { name: 'three agents', live: { agents }, summary: '3 agents connected.' },
    { name: 'agents while the server is paused', live: { status: 'paused', paused: true, agents: [agent('a', 'Codex', 'idle')] }, summary: 'Choose a client, copy the setup, then create a named workspace before browsing.' }
  ])('sums up $name under the Agents name', async ({ live, summary }) => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, ...live } })
    await flush()
    byId<HTMLButtonElement>('agents-section-connected').click()
    expect(words(byId('home-view-title'))).toBe('Agents')
    expect(words(byId('home-view-description'))).toBe(summary)
  })
})

describe('Agents view (HRO-65)', () => {
  const sections = () => [...document.querySelectorAll<HTMLElement>('.agent-sections [role=tab]')]
  const shown = () => ['home-tabs', 'home-workspaces', 'home-agents-view', 'home-connected', 'home-connect', 'home-overview', 'home-tools'].filter(id => !byId(id).hidden)

  it('holds the connected agents with their live activity, connecting one, the overview and the tool library', async () => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents } })
    await flush()
    expect(sections().map(words)).toEqual(['Connected agents', 'Connect an agent', 'Overview', 'Tool library'])
    expect(byId('home-connected').contains(byId('home-agents'))).toBe(true)
    expect(byId('home-connected').contains(byId('live-activity'))).toBe(true)
    expect(byId('home-workspaces').querySelector('#home-agents, #live-activity')).toBeNull()
  })

  it.each<{ name: string; live: Partial<HomeDashboard>; section: string }>([
    { name: 'the connected agents once one is connected', live: { agents }, section: 'home-connected' },
    { name: 'connecting one while none is', live: {}, section: 'home-connect' }
  ])('opens on $name', async ({ live, section }) => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, ...live } })
    await flush()
    byId<HTMLButtonElement>('home-tab-agents').click()
    expect(shown()).toEqual(['home-agents-view', section])
    expect(byId('home-tab-agents').getAttribute('aria-selected')).toBe('true')
    expect(byId(section.replace('home-', 'agents-section-')).getAttribute('aria-selected')).toBe('true')
  })

  it('opens on the section last shown there, after another view and after a reload', async () => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents } })
    await flush()
    byId<HTMLButtonElement>('agents-section-tools').click()
    byId<HTMLButtonElement>('home-tab-workspaces').click()
    byId<HTMLButtonElement>('home-tab-agents').click()
    expect(shown()).toEqual(['home-agents-view', 'home-tools'])
    byId<HTMLButtonElement>('home-tab-workspaces').click()
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents } })
    await flush()
    expect(shown()).toEqual(['home-workspaces'])
    byId<HTMLButtonElement>('home-tab-agents').click()
    expect(shown()).toEqual(['home-agents-view', 'home-tools'])
  })

  it('moves along its sections with the arrow keys, Home and End', async () => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents } })
    await flush()
    byId<HTMLButtonElement>('agents-section-connected').click()
    const press = (key: string) => (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    byId('agents-section-connected').focus()
    press('ArrowRight')
    expect(document.activeElement).toBe(byId('agents-section-connect'))
    expect(shown()).toEqual(['home-agents-view', 'home-connect'])
    press('End')
    expect(document.activeElement).toBe(byId('agents-section-tools'))
    press('ArrowRight')
    expect(document.activeElement).toBe(byId('agents-section-connected'))
    press('ArrowLeft')
    expect(document.activeElement).toBe(byId('agents-section-tools'))
    expect(sections().map(tab => tab.tabIndex)).toEqual([-1, -1, -1, 0])
  })

  it('opens from the status, on the agents it counts', async () => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents } })
    await flush()
    byId<HTMLButtonElement>('server-state').click()
    expect(shown()).toEqual(['home-agents-view', 'home-connected'])
    expect(document.activeElement).toBe(byId('agents-section-connected'))
  })

  // Every way into setup showed Connect an agent last, so the status and the Agents tab kept opening the setup guide.
  it('opens on the connected agents, not on connecting one, once an agent is connected', async () => {
    const home = mountTestHome({ workspaces: inventory() })
    await flush()
    byId<HTMLButtonElement>('home-tab-agents').click()
    expect(shown()).toEqual(['home-agents-view', 'home-connect'])
    byId<HTMLButtonElement>('home-tab-workspaces').click()
    home.show({ ...baseDashboard, agents })
    await flush()
    byId<HTMLButtonElement>('home-tab-agents').click()
    expect(shown()).toEqual(['home-agents-view', 'home-connected'])
    byId<HTMLButtonElement>('agents-section-connect').click()
    byId<HTMLButtonElement>('home-tab-tabs').click()
    byId<HTMLButtonElement>('server-state').click()
    expect(shown()).toEqual(['home-agents-view', 'home-connected'])
    byId<HTMLButtonElement>('agents-section-connect').click()
    byId<HTMLButtonElement>('home-tab-tabs').click()
    byId<HTMLButtonElement>('home-tab-agents').click()
    expect(shown()).toEqual(['home-agents-view', 'home-connected'])
  })
})

describe('Needs-you line (HRO-65)', () => {
  const lines = () => [...document.querySelectorAll<HTMLElement>('#home-needs-you .needs-you-line')]

  it('names the agent and workspace waiting for the person over every view, and opens that workspace', async () => {
    const workspaceAction = vi.fn().mockResolvedValue(inventory())
    mountTestHome({ workspaces: inventory(), api: { workspaceAction }, dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou'), docs: activity('working', 'codex') } } })
    await flush()
    expect(byId('home-needs-you').hidden).toBe(false)
    expect(lines().map(line => [words(query('.needs-you-words', line)), words(query('button', line))])).toEqual([['Claude Code needs you in Acme Store', 'Open workspace']])
    expect(byId('home-needs-you').hasAttribute('aria-live')).toBe(false)
    for (const view of ['tabs', 'agents', 'workspaces']) {
      byId<HTMLButtonElement>(`home-tab-${view}`).click()
      expect(byId('home-needs-you').hidden).toBe(false)
    }
    query<HTMLButtonElement>('button', lines()[0]).click()
    await flush()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'open', workspaceId: 'shop' })
  })

  it('shows one line for each workspace that needs the person, and none once they are answered', async () => {
    const home = mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou'), docs: activity('needs-you', 'gone', 'askYou') } } })
    await flush()
    expect(lines().map(line => words(query('.needs-you-words', line)))).toEqual(['Claude Code needs you in Acme Store', 'Agent needs you in Docs'])
    home.show({ ...baseDashboard, agents, workspaceActivity: { shop: activity('working', 'claude') } })
    await flush()
    expect(lines()).toEqual([])
    expect(byId('home-needs-you').hidden).toBe(true)
  })

  it('keeps its button and the focus on it while Home refreshes', async () => {
    const live = { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } }
    const home = mountTestHome({ workspaces: inventory(), dashboard: live })
    await flush()
    const button = query<HTMLButtonElement>('#home-needs-you button')
    button.focus()
    home.show({ ...live, workspaceActivity: { ...live.workspaceActivity, docs: activity('working', 'codex') } })
    await flush()
    expect(query('#home-needs-you button')).toBe(button)
    expect(document.activeElement).toBe(button)
  })

  it('names the workspace each line\'s button opens', async () => {
    mountTestHome({ workspaces: inventory(), dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou'), docs: activity('needs-you', 'codex', 'askYou') } } })
    await flush()
    expect(lines().map(line => query('button', line).getAttribute('aria-label'))).toEqual(['Open Acme Store', 'Open Docs'])
  })

  it('gives the keyboard to the view\'s tab when the line it was on goes', async () => {
    const live = { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } }
    const home = mountTestHome({ workspaces: inventory(), dashboard: live })
    await flush()
    byId<HTMLButtonElement>('home-tab-tabs').click()
    query<HTMLButtonElement>('#home-needs-you button').focus()
    home.show({ ...live, workspaceActivity: { shop: activity('working', 'claude') } })
    await flush()
    expect(byId('home-needs-you').hidden).toBe(true)
    expect(document.activeElement).toBe(byId('home-tab-tabs'))
  })

  // The error line sat in the Workspaces view, so a workspace that went away while it was opened from another view said
  // nothing, and focus went to a field hidden with that view.
  it('says why a workspace did not open from another view, and keeps the keyboard on that view', async () => {
    const workspaceAction = vi.fn().mockRejectedValue(new Error('Workspace is no longer available.'))
    mountTestHome({ workspaces: inventory(), api: { workspaceAction }, dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } } })
    await flush()
    byId<HTMLButtonElement>('home-tab-agents').click()
    const open = query<HTMLButtonElement>('#home-needs-you button')
    open.focus()
    open.click()
    await flush()
    const error = byId('workspace-error')
    expect(byId('home-workspaces').contains(error)).toBe(false)
    expect(error.hidden).toBe(false)
    expect(words(error)).toBe('Workspace is no longer available.')
    expect(byId('home-agents-view').hidden).toBe(false)
  })

  it('says nothing about an archived workspace', async () => {
    mountTestHome({ workspaces: inventory({ mcpTabGroups: [docs], savedTabGroups: [archivedWorkspace(shop)] }), dashboard: { ...baseDashboard, agents, workspaceActivity: { shop: activity('needs-you', 'claude', 'askYou') } } })
    await flush()
    expect(byId('home-needs-you').hidden).toBe(true)
  })
})

describe('Undo after archive and clear (#872)', () => {
  it('offers Undo after an archive, moves focus to it, and restores from it', async () => {
    const archived = inventory({ mcpTabGroups: [docs], savedTabGroups: [archivedWorkspace(shop)] })
    const workspaceAction = vi.fn().mockResolvedValueOnce(archived).mockResolvedValueOnce(inventory())
    const confirm = vi.spyOn(window, 'confirm')
    const home = mountTestHome({ workspaces: inventory(), api: { workspaceAction } })
    await flush()
    const menu = query<HTMLDetailsElement>('.card-menu', card('Acme Store'))
    menu.open = true
    home.setWorkspaces(archived)
    query<HTMLButtonElement>('[data-workspace-action="archive"]', menu).click()
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'archive', workspaceId: 'shop' })
    expect(words(byId('workspace-notice'))).toBe('“Acme Store” archived. Tabs and sign-ins are saved.')
    const undo = byId<HTMLButtonElement>('workspace-undo')
    expect(undo.hidden).toBe(false)
    expect(document.activeElement).toBe(undo)

    home.setWorkspaces(inventory())
    undo.click()
    await flush()
    expect(workspaceAction).toHaveBeenLastCalledWith({ view: 'restore', workspaceId: 'shop' })
    expect(words(byId('workspace-notice'))).toBe('“Acme Store” restored.')
    expect(undo.hidden).toBe(true)
  })

  it('keeps a held Enter from pressing Undo or a card menu button again', async () => {
    // Archiving hands the focus to Undo, and a menu's action hands it back to the menu's button, so a held Enter's
    // repeats restored the workspace just archived and opened the menu again.
    const archived = inventory({ mcpTabGroups: [docs], savedTabGroups: [archivedWorkspace(shop)] })
    const workspaceAction = vi.fn().mockResolvedValue(archived)
    const home = mountTestHome({ workspaces: inventory(), api: { workspaceAction } })
    await flush()
    const pressEnter = (target: Element, repeat: boolean): boolean => {
      const event = new KeyboardEvent('keydown', { key: 'Enter', repeat, bubbles: true, cancelable: true })
      target.dispatchEvent(event)
      return event.defaultPrevented
    }
    const menu = query<HTMLDetailsElement>('.card-menu', card('Acme Store'))
    expect(pressEnter(query('summary', menu), true)).toBe(true)
    expect(pressEnter(query('summary', menu), false)).toBe(false)
    menu.open = true
    home.setWorkspaces(archived)
    query<HTMLButtonElement>('[data-workspace-action="archive"]', menu).click()
    await flush()
    const undo = byId<HTMLButtonElement>('workspace-undo')
    expect(document.activeElement).toBe(undo)
    expect(pressEnter(undo, true)).toBe(true)
    expect(pressEnter(undo, false)).toBe(false)
    // The search field keeps its own keys.
    expect(pressEnter(byId('workspace-search'), true)).toBe(false)
  })

  it('offers Undo after an undoable clear and moves focus to it', async () => {
    const cleared = inventory({ mcpTabGroups: [docs], savedTabGroups: [archivedWorkspace(shop)] })
    const workspaceAction = vi.fn().mockResolvedValue(cleared)
    const confirm = vi.spyOn(window, 'confirm')
    const home = mountTestHome({ workspaces: inventory(), api: { workspaceAction } })
    await flush()
    query<HTMLDetailsElement>('.card-menu', card('Acme Store')).open = true
    home.setWorkspaces(cleared)
    query<HTMLButtonElement>('[data-workspace-action="clear"]', card('Acme Store')).click()
    await flush()
    expect(confirm).not.toHaveBeenCalled()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'clear', workspaceId: 'shop', undoable: true })
    expect(document.activeElement).toBe(byId('workspace-undo'))
    // Undo goes once the shell deletes the cleared workspace's archive.
    home.setWorkspaces(inventory({ mcpTabGroups: [docs] }))
    await vi.advanceTimersByTimeAsync(2000)
    expect(byId('workspace-undo').hidden).toBe(true)
  })

  it('keeps focus in the list on search after a clear that cannot be undone', async () => {
    const full = Array.from({ length: 50 }, (_, index) => archivedWorkspace(openWorkspace(`old-${index}`), isoMinutesAgo(600 + index)))
    const before = inventory({ savedTabGroups: full })
    const after = inventory({ mcpTabGroups: [docs], savedTabGroups: full })
    const workspaceAction = vi.fn().mockResolvedValue(after)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // Main still reports the workspace when Home reads the workspaces again after the yes; the clear returns the rest.
    mountTestHome({ workspaces: before, api: { workspaceAction } })
    await flush()
    query<HTMLButtonElement>('[data-workspace-action="clear"]', card('Acme Store')).click()
    await flush()
    expect(workspaceAction).toHaveBeenCalledWith({ view: 'clear', workspaceId: 'shop', undoable: false })
    expect(byId('workspace-undo').hidden).toBe(true)
    expect(document.activeElement).toBe(byId('workspace-search'))
  })
})
