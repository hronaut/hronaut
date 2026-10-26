import { fireEvent, render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { nextTick, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BrowserTabsBar from '../../src/renderer/src/components/BrowserTabsBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { AgentPresence, AgentPresenceSnapshot, HronautAgentPresenceApi } from '../../src/shared/agent-presence.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../src/shared/types.js'

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
}

beforeEach(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: memoryStorage() })
})

afterEach(() => {
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
})

function workspace(id = 'workspace-1'): BrowserTabGroupState {
  return {
    id,
    name: 'Research',
    description: '',
    color: 'purple',
    createdAt: '2026-08-22T09:00:00.000Z',
    lastUsedAt: '2026-08-22T09:00:00.000Z',
    tabCount: 0,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] }
  }
}

function tab(id: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url: `https://example.test/${id}`,
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
    mcpGroupId: 'workspace-1',
    mcpGroupName: 'Research',
    ...overrides
  }
}

function browserState(overrides: Partial<BrowserState> = {}): BrowserState {
  const home = tab('home', {
    title: 'Hronaut Home',
    url: 'hronaut://home',
    active: true,
    mcpGroupId: undefined,
    mcpGroupName: undefined
  })
  const first = tab('first')
  return {
    tabs: [home, first],
    closedTabs: [],
    activeTabId: home.id,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47891/mcp',
    profilePath: '/tmp/hronaut-test',
    mcpTabGroups: [workspace()],
    savedTabGroups: [],
    ...overrides
  }
}

function renderTabs(
  state = browserState(),
  hydrated = true,
  orientation: 'horizontal' | 'vertical' = 'horizontal',
  railPinned = true,
  locale: SupportedLocale = 'en-US'
) {
  return render(BrowserTabsBar, {
    global: { plugins: [createHronautI18n(locale)] },
    props: {
      state,
      hydrated,
      orientation,
      railPinned,
      mcpActivityByTab: {},
      formatNumber: (value: number) => String(value),
      tabTooltip: (value: BrowserTabState) => value.title,
      describeEmulation: () => ''
    }
  })
}

describe('BrowserTabsBar', () => {
  it('draws only the row of a tab that changed, as when one of many loading pages gets its title', async () => {
    const first = tab('first', { networkRouteCount: 7 })
    const second = tab('second', { loading: true })
    const state = browserState({ tabs: [first, second] })
    // As in the shell, a tab's name reads the whole browser state, which each change replaces.
    const current = shallowRef(state)
    const tabTooltip = (value: BrowserTabState): string => current.value.tabs.find(candidate => candidate.id === value.id)?.title ?? value.title
    // Only the first tab's row counts its 7 rules, so each call with 7 is that row drawing.
    const formatNumber = vi.fn((value: number) => String(value))
    const view = render(BrowserTabsBar, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { state, hydrated: true, orientation: 'vertical', railPinned: true, mcpActivityByTab: {}, formatNumber, tabTooltip, describeEmulation: () => '' }
    })
    expect(formatNumber).toHaveBeenCalledWith(7)
    formatNumber.mockClear()
    // The shell's store keeps the object of each tab that did not change.
    const next = { ...state, tabs: [first, { ...second, title: 'Loaded', loading: false }] }
    current.value = next
    await view.rerender({ state: next })
    expect(screen.getByRole('tab', { name: 'Loaded' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Page first' })).toBeTruthy()
    expect(formatNumber.mock.calls.filter(([value]) => value === 7)).toEqual([])
  })

  it.each(['horizontal', 'vertical'] as const)('normalizes wheel units in the %s tab strip', async orientation => {
    renderTabs(browserState(), true, orientation)
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 1280 },
      clientHeight: { configurable: true, value: 240 },
      scrollHeight: { configurable: true, value: 960 },
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollTop: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    for (const { mode, lineHeight, expected } of [
      { mode: WheelEvent.DOM_DELTA_PIXEL, lineHeight: '20px', expected: 2 },
      { mode: WheelEvent.DOM_DELTA_LINE, lineHeight: '20px', expected: 40 },
      { mode: WheelEvent.DOM_DELTA_LINE, lineHeight: 'normal', expected: 32 },
      { mode: WheelEvent.DOM_DELTA_PAGE, lineHeight: '20px', expected: orientation === 'vertical' ? 480 : 640 }
    ]) {
      strip.scrollLeft = strip.scrollTop = 0
      strip.style.lineHeight = lineHeight
      const event = new WheelEvent('wheel', { cancelable: true, deltaY: 2, deltaMode: mode })
      strip.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(orientation === 'vertical' ? strip.scrollTop : strip.scrollLeft).toBe(expected)
      const zoom = new WheelEvent('wheel', { cancelable: true, deltaY: 2, deltaMode: mode, ctrlKey: true })
      strip.dispatchEvent(zoom)
      expect(zoom.defaultPrevented).toBe(false)
      expect(orientation === 'vertical' ? strip.scrollTop : strip.scrollLeft).toBe(expected)
    }
  })

  it.each(['horizontal', 'vertical'] as const)('selects Settings independently of the underlying website in the %s rail', async orientation => {
    const view = renderTabs(browserState({ tabs: [tab('first', { active: true })], activeTabId: 'first' }), true, orientation)
    await view.rerender({ settingsActive: true })
    expect(screen.queryByRole('tab', { name: 'Settings' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Page first' })).toHaveAttribute('aria-selected', 'false')
    await view.rerender({ settingsActive: false })
    expect(screen.getByRole('tab', { name: 'Page first' })).toHaveAttribute('aria-selected', 'true')
  })

  it.each(['horizontal', 'vertical'] as const)('names a blank tab in the interface language in the %s strip', orientation => {
    // Hronaut calls a blank tab "New tab" until a page names it; the strip showed that English title in every language.
    const view = renderTabs(browserState({ tabs: [
      tab('blank', { title: 'New tab', url: 'about:blank' }),
      tab('site', { title: 'New tab', url: 'https://example.test/new' })
    ] }), true, orientation, true, 'uk-UA')
    const row = (id: string) => view.container.querySelector<HTMLElement>(`[data-tab-id="${id}"]`)!
    expect(row('blank').querySelector('.tab-title')?.textContent).toBe('Нова вкладка')
    expect(row('blank').textContent).not.toContain('New tab')
    // A website that calls itself "New tab" keeps its own title.
    expect(row('site').querySelector('.tab-title')?.textContent).toBe('New tab')
  })

  it('draws a tab\'s own lock and mute, not the browser-wide ones on every row', async () => {
    // 3.0 drew a lock and a muted speaker on every row while the browser-wide lock and mute were on.
    const view = renderTabs(browserState({ tabs: [
      tab('own-lock', { humanInteractionLocked: true, humanInteractionInputLocked: true }),
      tab('own-mute', { muted: true }),
      tab('plain')
    ] }), true, 'vertical')
    const marks = (id: string) => ({
      lock: view.container.querySelector(`[data-tab-id="${id}"] .tab-lock-mark`) !== null,
      speaker: view.container.querySelector(`[data-tab-id="${id}"] .tab-audio`) !== null
    })
    expect(marks('own-lock')).toEqual({ lock: true, speaker: false })
    expect(marks('own-mute')).toEqual({ lock: false, speaker: true })
    expect(marks('plain')).toEqual({ lock: false, speaker: false })

    // The pressed browser-wide buttons say it for every tab; a row keeps only the speaker of a tab that plays sound.
    await view.rerender({ state: browserState({ allHumanInteractionLocked: true, allTabsMuted: true, tabs: [
      tab('silent', { muted: true, humanInteractionLocked: true, humanInteractionInputLocked: true }),
      tab('playing', { muted: true, audible: true, humanInteractionInputLocked: true }),
      tab('exception', { humanInteractionInputLocked: false })
    ] }) })
    expect(marks('silent')).toEqual({ lock: false, speaker: false })
    expect(marks('playing')).toEqual({ lock: false, speaker: true })
    expect(marks('exception')).toEqual({ lock: false, speaker: false })
    expect(view.container.querySelector('[data-tab-id="playing"] .tab-audio')).toHaveClass('muted')
  })

  it('says why an agent waiting on a decision needs you in the interface language', async () => {
    // The tab read "Agent benötigt Ihre Aufmerksamkeit: Human decision required: provide-input".
    const view = renderTabs(browserState({ tabs: [tab('first'), tab('second', { active: true })], activeTabId: 'second' }), true, 'horizontal', true, 'de-DE')
    const first = screen.getByRole('tab', { name: 'Page first' })
    await view.rerender({ userAttention: { id: 'attention-1', reason: 'Human decision required: provide-input', requestedAt: '2026-10-21T00:00:00.000Z', tabId: 'first', humanWaitingDecisionId: 'decision-1' } })
    expect(first).toHaveAccessibleDescription('Agent benötigt Ihre Aufmerksamkeit: Der Agent braucht Ihre Antwort, um weiterzumachen.')
    expect(first.dataset.tooltip).toBe('Page first\n\nAgent benötigt Ihre Aufmerksamkeit: Der Agent braucht Ihre Antwort, um weiterzumachen.')
    // An agent's own request keeps its words.
    await view.rerender({ userAttention: { id: 'attention-2', reason: 'Approve this step.', requestedAt: '2026-10-21T00:00:00.000Z', tabId: 'first' } })
    expect(first).toHaveAccessibleDescription('Agent benötigt Ihre Aufmerksamkeit: Approve this step.')
  })

  it('says why a workspace waiting on a decision needs you, with each language\'s punctuation', async () => {
    const view = renderTabs(browserState({ tabs: [tab('first'), tab('second', { active: true })], activeTabId: 'second' }), true, 'horizontal', true, 'fr-FR')
    await view.rerender({ userAttention: { id: 'attention-1', reason: 'Human decision required: approve-action', requestedAt: '2026-10-21T00:00:00.000Z', tabId: 'first', humanWaitingDecisionId: 'decision-1' } })
    const header = view.container.querySelector('[aria-description*="L’agent a besoin de votre attention"]:not([role="tab"])')
    expect(header?.getAttribute('aria-description')).toBe('L’agent a besoin de votre attention : L’agent attend votre accord avant d’agir.')
    expect(screen.getByRole('tab', { name: 'Page first' })).toHaveAccessibleDescription('L’agent a besoin de votre attention : L’agent attend votre accord avant d’agir.')
  })

  it.each(['horizontal', 'vertical'] as const)('marks only the requested tab in the %s rail and clears it with the request', async orientation => {
    const view = renderTabs(browserState({ tabs: [tab('first'), tab('second', { active: true })], activeTabId: 'second' }), true, orientation)
    const first = screen.getByRole('tab', { name: 'Page first' })
    const second = screen.getByRole('tab', { name: 'Page second' })
    await view.rerender({ userAttention: { id: 'attention-1', reason: 'Approve this step.', requestedAt: '2026-09-23T00:00:00.000Z', tabId: 'first' } })
    expect(first).toHaveClass('needs-attention')
    expect(first).toHaveAccessibleDescription('Agent needs your attention: Approve this step.')
    expect(first.querySelector('.tab-attention-badge')).toBeInTheDocument()
    expect(second).not.toHaveClass('needs-attention')
    await view.rerender({ userAttention: null })
    expect(first).not.toHaveClass('needs-attention')
    expect(first.querySelector('.tab-attention-badge')).not.toBeInTheDocument()
    expect(first).not.toHaveAttribute('aria-description')
  })

  it.each(['horizontal', 'vertical'] as const)('shows which workspace needs you in the %s rail while it is folded or inactive', async orientation => {
    const waiting = { ...workspace('workspace-2'), name: 'Checkout QA', description: 'Staging checkout' }
    const view = renderTabs(browserState({
      tabs: [
        tab('first', { active: true }),
        tab('review', { mcpGroupId: waiting.id, mcpGroupName: waiting.name })
      ],
      activeTabId: 'first',
      mcpTabGroups: [workspace(), waiting]
    }), true, orientation)
    const waitingHeader = screen.getByRole('button', { name: 'Collapse workspace Checkout QA, 1 tab' })
    await userEvent.click(waitingHeader)
    const folded = screen.getByRole('button', { name: 'Expand workspace Checkout QA, 1 tab' })
    expect(screen.queryByRole('tab', { name: 'Page review' })).toBeNull()

    await view.rerender({ userAttention: { id: 'attention-1', reason: 'Approve the refund.', requestedAt: '2026-10-16T07:00:00.000Z', workspaceId: waiting.id, tabId: 'review' } })
    expect(folded).toHaveAccessibleName('Expand workspace Checkout QA, 1 tab, Needs you')
    expect(folded).toHaveAccessibleDescription('Agent needs your attention: Approve the refund.\n\nStaging checkout')
    expect(folded).toHaveTextContent('Checkout QA Needs you 1')
    expect(folded.closest('.workspace-tab-section')).toHaveClass('needs-you')
    const research = screen.getByRole('button', { name: 'Collapse workspace Research, 1 tab' })
    expect(research.closest('.workspace-tab-section')).not.toHaveClass('needs-you')
    expect(research.querySelector('.tab-group-needs-you')).toBeNull()

    await view.rerender({ userAttention: { id: 'attention-2', reason: 'Pick a plan.', requestedAt: '2026-10-16T07:01:00.000Z', workspaceId: 'workspace-1' } })
    expect(folded.closest('.workspace-tab-section')).not.toHaveClass('needs-you')
    expect(research).toHaveAccessibleName('Collapse workspace Research, 1 tab, Needs you')
    expect(research.closest('.workspace-tab-section')).toHaveClass('needs-you')

    await view.rerender({ userAttention: null })
    expect(research).toHaveAccessibleName('Collapse workspace Research, 1 tab')
    expect(research.getAttribute('aria-description') ?? '').not.toContain('Agent needs your attention')
    expect(document.querySelector('.workspace-tab-section.needs-you')).toBeNull()
    expect(folded).toHaveAccessibleDescription('Staging checkout')
  })

  it('folds workspaces past the first ten into an All N workspaces row that opens the switcher', async () => {
    const groups = Array.from({ length: 14 }, (_, index) => ({ ...workspace(`w${index + 1}`), name: `Client ${index + 1}` }))
    const tabs = groups.map((group, index) => tab(`t${index + 1}`, { mcpGroupId: group.id, mcpGroupName: group.name, active: index === 12 }))
    const headers = () => [...document.querySelectorAll('.tab-group-label')].map((label) => label.querySelector('span')?.textContent)
    const view = renderTabs(browserState({ tabs, activeTabId: 't13', mcpTabGroups: groups }), true, 'vertical')

    // The first ten, then the workspace in view in its place in the order.
    expect(headers()).toEqual([...groups.slice(0, 10), groups[12]].map((group) => group.name))
    expect(screen.queryByRole('tab', { name: 'Page t12' })).toBeNull()
    const row = screen.getByRole('button', { name: 'All 14 workspaces' })
    expect(row).toHaveAttribute('aria-haspopup', 'dialog')
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(row).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K')
    expect(row).toHaveAccessibleDescription('Show all workspaces (Ctrl/Cmd+K)')
    expect(row.querySelector('.all-workspaces-needs-you')).toBeNull()
    await userEvent.click(row)
    expect(view.emitted('switchWorkspace')).toHaveLength(1)
    // The switcher gives the focus back to the row when it closes, so a held Enter's repeats would open it again.
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    row.dispatchEvent(repeat)
    expect(repeat.defaultPrevented).toBe(true)
    await view.rerender({ workspaceSwitcherOpen: true })
    expect(row).toHaveAttribute('aria-expanded', 'true')

    // A workspace that needs you stays listed too, even under Settings.
    await view.rerender({ settingsActive: true, userAttention: { id: 'attention-1', reason: 'Approve the refund.', requestedAt: '2026-10-16T07:00:00.000Z', workspaceId: 'w12', tabId: 't12' } })
    expect(headers()).toEqual([...groups.slice(0, 10), groups[11], groups[12]].map((group) => group.name))
    expect(screen.getByRole('button', { name: 'Collapse workspace Client 12, 1 tab, Needs you' }).closest('.workspace-tab-section')).toHaveClass('needs-you')
    expect(screen.getByRole('button', { name: 'All 14 workspaces' })).not.toHaveClass('needs-you')

    // Keyboard navigation skips folded tabs: from the tenth workspace's tab the next is the one in view.
    await view.rerender({ settingsActive: false, userAttention: null })
    screen.getByRole('tab', { name: 'Page t1' }).focus()
    await userEvent.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'Page t13' })).toHaveFocus()
    screen.getByRole('tab', { name: 'Page t10' }).focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getByRole('tab', { name: 'Page t13' })).toHaveFocus()

    // Home has no workspace of its own, so the one last worked in stays listed under it.
    await view.rerender({ state: browserState({ tabs: [tab('home', { url: 'hronaut://home', active: true, mcpGroupId: undefined, mcpGroupName: undefined }), ...tabs.map((value) => ({ ...value, active: false }))], activeTabId: 'home', mcpTabGroups: groups }) })
    expect(headers()).toEqual([...groups.slice(0, 10), groups[12]].map((group) => group.name))

    // The tab strip above the page lists every workspace and has no row.
    await view.rerender({ orientation: 'horizontal' })
    expect(headers()).toHaveLength(14)
    expect(screen.queryByRole('button', { name: 'All 14 workspaces' })).toBeNull()
  })

  it('recomputes the rail\'s overflow when a workspace folds away or comes back', async () => {
    const groups = Array.from({ length: 14 }, (_, index) => ({ ...workspace(`w${index + 1}`), name: `Client ${index + 1}` }))
    const tabs = groups.map((group, index) => tab(`t${index + 1}`, { mcpGroupId: group.id, mcpGroupName: group.name, active: index === 12 }))
    const view = renderTabs(browserState({ tabs, activeTabId: 't13', mcpTabGroups: groups }), true, 'vertical')
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    // Content follows the sections drawn: about 110 px each against a 1,200 px strip.
    const contentHeight = () => strip.querySelectorAll('.workspace-tab-section').length * 110
    Object.defineProperties(strip, {
      clientHeight: { configurable: true, value: 1_200 },
      scrollHeight: { configurable: true, get: contentHeight },
      scrollTop: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeVisible()

    // Working in the second workspace folds the thirteenth away, and the rest fits.
    await view.rerender({ state: browserState({ tabs: tabs.map((value, index) => ({ ...value, active: index === 1 })), activeTabId: 't2', mcpTabGroups: groups }) })
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument())

    // A request in a folded workspace lists it again, and the rail overflows again.
    await view.rerender({ userAttention: { id: 'attention-1', reason: 'Approve the refund.', requestedAt: '2026-10-16T07:00:00.000Z', workspaceId: 'w14', tabId: 't14' } })
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeVisible())
  })

  it('lists eleven workspaces without the row, since folding one would only swap it for the row', () => {
    const groups = Array.from({ length: 11 }, (_, index) => ({ ...workspace(`w${index + 1}`), name: `Client ${index + 1}` }))
    renderTabs(browserState({ mcpTabGroups: groups }), true, 'vertical')
    expect(document.querySelectorAll('.tab-group-label')).toHaveLength(11)
    expect(document.querySelector('[data-testid="all-workspaces"]')).toBeNull()
  })

  it('shows the row with an amber dot while a workspace the rail does not list needs you', async () => {
    const hidden = { ...workspace('workspace-2'), name: 'Checkout QA', hiddenFromSidebar: true }
    const view = renderTabs(browserState({ mcpTabGroups: [workspace(), hidden] }), true, 'vertical')
    expect(document.querySelector('[data-testid="all-workspaces"]')).toBeNull()

    await view.rerender({ userAttention: { id: 'attention-1', reason: 'Approve the refund.', requestedAt: '2026-10-16T07:00:00.000Z', workspaceId: hidden.id } })
    const row = screen.getByRole('button', { name: 'All 2 workspaces' })
    expect(row).toHaveAccessibleDescription('A workspace not listed here needs you')
    expect(row).toHaveClass('needs-you')
    expect(row.querySelector('.all-workspaces-needs-you')).not.toBeNull()
    // The hidden workspace stays out of the rail, as its setting says.
    expect(document.querySelectorAll('.tab-group-label')).toHaveLength(1)

    // A request in a listed workspace leaves the row out.
    await view.rerender({ userAttention: { id: 'attention-2', reason: 'Pick a plan.', requestedAt: '2026-10-16T07:01:00.000Z', workspaceId: 'workspace-1' } })
    expect(document.querySelector('[data-testid="all-workspaces"]')).toBeNull()
    await view.rerender({ userAttention: null })
    expect(document.querySelector('[data-testid="all-workspaces"]')).toBeNull()
  })

  it('follows the requested tab rather than the reported workspace when the tab moved', async () => {
    const other = { ...workspace('workspace-2'), name: 'Billing' }
    const view = renderTabs(browserState({
      tabs: [tab('first', { active: true }), tab('moved', { mcpGroupId: other.id, mcpGroupName: other.name })],
      activeTabId: 'first',
      mcpTabGroups: [workspace(), other]
    }), true, 'vertical')
    await view.rerender({ userAttention: { id: 'attention-1', reason: 'Confirm.', requestedAt: '2026-10-16T07:00:00.000Z', workspaceId: 'workspace-1', tabId: 'moved' } })
    expect(screen.getByRole('button', { name: 'Collapse workspace Billing, 1 tab, Needs you' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse workspace Research, 1 tab' })).toBeInTheDocument()
  })

  it('names the agent it follows under the workspace following brought into view, with Stay here', async () => {
    const billing = { ...workspace('workspace-2'), name: 'Billing' }
    const followed = browserState({
      tabs: [tab('first'), tab('invoice', { active: true, mcpGroupId: billing.id, mcpGroupName: billing.name })],
      activeTabId: 'invoice',
      mcpTabGroups: [workspace(), billing],
      agentFollow: { tabId: 'invoice', agentName: 'Claude Code' }
    })
    const view = renderTabs(followed, true, 'vertical')
    const row = screen.getByTestId('workspace-following')
    expect(row).toHaveTextContent('Following Claude Code')
    // A long name is cut to fit, so its tooltip carries it in full.
    expect(within(row).getByText('Following Claude Code')).toHaveAttribute('data-tooltip', 'Following Claude Code')
    expect(within(screen.getByRole('group', { name: 'Billing' })).getByTestId('workspace-following')).toBe(row)
    // Beside the workspace header, never inside it: the header is itself a button.
    expect(row.closest('button')).toBeNull()
    const stay = within(row).getByRole('button', { name: 'Stay here' })
    expect(stay).toHaveAccessibleDescription('Stop following agents and stay on this tab')
    await fireEvent.click(stay)
    expect(view.emitted().stayHere).toEqual([[]])

    // The person has moved to another tab, so following no longer shows this page.
    await view.rerender({ state: {
      ...followed,
      tabs: [tab('first', { active: true }), tab('invoice', { mcpGroupId: billing.id, mcpGroupName: billing.name })],
      activeTabId: 'first'
    } })
    expect(screen.queryByTestId('workspace-following')).toBeNull()
    await view.rerender({ state: { ...followed, agentFollow: undefined } })
    expect(screen.queryByTestId('workspace-following')).toBeNull()
    // A client whose name cleans to nothing is named as its avatar is.
    await view.rerender({ state: { ...followed, agentFollow: { tabId: 'invoice', agentName: '' } } })
    expect(screen.getByTestId('workspace-following')).toHaveTextContent('Following Agent')
    await view.rerender({ state: followed, orientation: 'horizontal' })
    expect(screen.queryByTestId('workspace-following')).toBeNull()
  })

  it('shows a workspace\'s agents in its header and opens it when one starts working or needs you', async () => {
    const presenceAgent = (name: string, state: AgentPresence['state'], colorIndex = 1): AgentPresence => (
      { clientKey: `key-${name}`, name, initial: name.slice(0, 1), colorIndex, state, step: 'click', recentSteps: [] }
    )
    let listener!: (snapshot: AgentPresenceSnapshot) => void
    let revision = 1
    const presenceApi: HronautAgentPresenceApi = {
      get: () => Promise.resolve({ revision: 1, workspaces: { 'workspace-1': [presenceAgent('Claude Code', 'idle')] } }),
      onChanged: (next) => { listener = next; return () => undefined }
    }
    const publish = async (agents: AgentPresence[]) => { listener({ revision: ++revision, workspaces: { 'workspace-1': agents } }); await nextTick() }
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1']))
    render(BrowserTabsBar, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        state: browserState(),
        hydrated: true,
        orientation: 'vertical',
        railPinned: true,
        presenceApi,
        mcpActivityByTab: {},
        formatNumber: (value: number) => String(value),
        tabTooltip: (value: BrowserTabState) => value.title,
        describeEmulation: () => ''
      }
    })
    await flushPromises()
    // A folded group stays folded on reload, even with an agent in it.
    const header = screen.getByRole('button', { name: 'Expand workspace Research, 1 tab' })
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(header).toHaveAccessibleDescription('Agents here: Claude Code (Idle)')
    const avatars = () => [...within(header).getByTestId('workspace-agents').children].map((avatar) => [avatar.getAttribute('data-initial'), avatar.getAttribute('data-state')])
    expect(avatars()).toEqual([['C', 'idle']])

    // The agent already there resuming after a pause opens nothing.
    await publish([presenceAgent('Claude Code', 'working')])
    expect(header).toHaveAttribute('aria-expanded', 'false')
    // Another agent starting to work there does.
    await publish([presenceAgent('Claude Code', 'working'), presenceAgent('Cursor', 'working', 2)])
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header).toHaveAccessibleName('Collapse workspace Research, 1 tab')
    expect(header).toHaveAccessibleDescription('Agents here: Claude Code (Working), Cursor (Working)')
    expect(avatars()).toEqual([['C', 'working'], ['C', 'working']])
    // Folding it again holds while the same agents work.
    await fireEvent.click(header)
    await publish([presenceAgent('Claude Code', 'idle'), presenceAgent('Cursor', 'working', 2)])
    await publish([presenceAgent('Claude Code', 'working'), presenceAgent('Cursor', 'working', 2)])
    expect(header).toHaveAttribute('aria-expanded', 'false')
    await publish([presenceAgent('Claude Code', 'needs-you'), presenceAgent('Cursor', 'working', 2)])
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])

    // Past three agents the rest are counted, in the avatars and the description, and the header's name never
    // includes the drawn initials.
    await publish(['Claude Code', 'Cursor', 'Windsurf', 'Codex', 'Zed'].map((name) => presenceAgent(name, 'idle')))
    expect(avatars().at(-1)).toEqual(['+2', null])
    expect(within(header).getByTestId('workspace-agents').children).toHaveLength(4)
    expect(header).toHaveAccessibleName('Collapse workspace Research, 1 tab')
    expect(header).toHaveAccessibleDescription('Agents here: Claude Code (Idle), Cursor (Idle), Windsurf (Idle), +2')
    await publish([])
    expect(within(header).queryByTestId('workspace-agents')).toBeNull()
    expect(header.getAttribute('aria-description')).not.toContain('Agents here')
  })

  it('opens no folded workspace by itself in the top tab strip', async () => {
    let listener!: (snapshot: AgentPresenceSnapshot) => void
    const presenceApi: HronautAgentPresenceApi = {
      get: () => Promise.resolve({ revision: 1, workspaces: {} }),
      onChanged: (next) => { listener = next; return () => undefined }
    }
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1']))
    render(BrowserTabsBar, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        state: browserState(),
        hydrated: true,
        orientation: 'horizontal',
        railPinned: true,
        presenceApi,
        mcpActivityByTab: {},
        formatNumber: (value: number) => String(value),
        tabTooltip: (value: BrowserTabState) => value.title,
        describeEmulation: () => ''
      }
    })
    await flushPromises()
    listener({ revision: 2, workspaces: { 'workspace-1': [{ clientKey: 'key-claude', name: 'Claude Code', initial: 'C', colorIndex: 1, state: 'needs-you', step: 'askYou', recentSteps: [] }] } })
    await nextTick()
    expect(screen.getByRole('button', { name: /^Expand workspace Research, 1 tab/u })).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps pinned workspaces on top of the rail and the strip, in the order they were pinned, marked as pinned', async () => {
    const named = (id: string, name: string, pinnedAt?: string): BrowserTabGroupState => ({ ...workspace(id), name, ...(pinnedAt ? { pinnedAt } : {}) })
    const groups = [named('w-a', 'Alpha'), named('w-b', 'Beta', '2026-10-17T02:00:00.000Z'), named('w-c', 'Gamma'), named('w-d', 'Delta', '2026-10-17T01:00:00.000Z')]
    const state = browserState({
      tabs: groups.map((group) => tab(`tab-${group.id}`, { mcpGroupId: group.id, mcpGroupName: group.name })),
      activeTabId: null,
      mcpTabGroups: groups
    })
    const view = renderTabs(state, true, 'vertical')
    const order = () => [...document.querySelectorAll('.tab-group-label')].map((label) => label.querySelector('.tab-group-name')?.textContent)
    expect(order()).toEqual(['Delta', 'Beta', 'Alpha', 'Gamma'])
    const delta = screen.getByRole('button', { name: 'Collapse workspace Delta, 1 tab' })
    expect(within(delta).getByTestId('workspace-pinned')).toBeInTheDocument()
    // Pinned is said in the description; the name stays the visible name.
    expect(delta).toHaveAccessibleDescription(/^Pinned to the top/u)
    expect(within(screen.getByRole('button', { name: 'Collapse workspace Alpha, 1 tab' })).queryByTestId('workspace-pinned')).toBeNull()
    // Unpinning puts it back in its place.
    await view.rerender({ state: { ...state, mcpTabGroups: groups.map((group) => group.id === 'w-d' ? named('w-d', 'Delta') : group) } })
    expect(order()).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta'])
    await view.rerender({ orientation: 'horizontal' })
    expect(order()).toEqual(['Beta', 'Alpha', 'Gamma', 'Delta'])

    // Pinned workspaces never fold away into the All workspaces row, however many there are.
    const many = [
      ...Array.from({ length: 12 }, (_, index) => named(`p${index + 1}`, `Pinned ${index + 1}`, `2026-10-17T00:${String(index).padStart(2, '0')}:00.000Z`)),
      named('w-x', 'Loose 1'),
      named('w-y', 'Loose 2')
    ]
    await view.rerender({ orientation: 'vertical', state: browserState({ tabs: many.map((group) => tab(`tab-${group.id}`, { mcpGroupId: group.id, mcpGroupName: group.name })), activeTabId: null, mcpTabGroups: many }) })
    expect(order()).toEqual(many.slice(0, 12).map((group) => group.name))
    expect(screen.getByRole('button', { name: 'All 14 workspaces' })).toBeVisible()
  })

  it('describes agent activity without replacing the tab name or its navigation controls', async () => {
    const view = renderTabs(browserState({ tabs: [tab('first'), tab('second', { active: true })], activeTabId: 'second' }))
    const first = screen.getByRole('tab', { name: 'Page first' })
    const second = screen.getByRole('tab', { name: 'Page second' })
    await view.rerender({ mcpActivityByTab: {
      first: { activityId: 'request-1', tabId: 'first', toolName: 'browser_snapshot', phase: 'started', occurredAt: 1 }
    } })
    expect(first).toHaveAccessibleName('Page first')
    expect(first).toHaveAccessibleDescription('Agent active')
    expect(first).toHaveAttribute('data-tooltip', 'Page first\n\nAgent active')
    expect(first).toHaveAttribute('aria-selected', 'false')
    expect(second).toHaveAttribute('aria-selected', 'true')
    expect(second).not.toHaveAttribute('aria-description')
    await fireEvent.click(first)
    expect(view.emitted().selectTab).toEqual([['first']])
    await view.rerender({ mcpActivityByTab: {} })
    expect(first).not.toHaveAttribute('aria-description')
    expect(first).toHaveAttribute('data-tooltip', 'Page first')
  })

  it('keeps live workspace descriptions in workspace-header hover text without rendering a preview', async () => {
    const description = 'Compare checkout flows.\nKeep the signed-in QA session.'
    const state = browserState({ mcpTabGroups: [{ ...workspace(), description }] })
    const view = renderTabs(state, true, 'vertical')
    const header = document.querySelector('.tab-group-label')!
    expect(screen.queryByText(description)).not.toBeInTheDocument()
    expect(header).toHaveAccessibleDescription(description)
    expect(header.getAttribute('data-tooltip')).toContain(description)
    await fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(description)).not.toBeInTheDocument()
    await view.rerender({ state: { ...state, mcpTabGroups: [{ ...workspace(), description: 'Verify the saved cart.' }] } })
    expect(header).toHaveAccessibleDescription('Verify the saved cart.')
    expect(header.getAttribute('data-tooltip')).toContain('Verify the saved cart.')
    expect(screen.queryByText('Verify the saved cart.')).not.toBeInTheDocument()
    await view.rerender({ state: { ...state, mcpTabGroups: [workspace()] } })
    // Without a description only the expand or collapse hint describes it, as its native title did.
    expect(header).toHaveAccessibleDescription(header.getAttribute('data-tooltip')!)
    expect(header.getAttribute('aria-description')).not.toContain('Verify the saved cart.')
  })

  it('also exposes descriptions only as hover text in the horizontal tab strip', async () => {
    const description = 'Release checks and saved browser context.'
    renderTabs(browserState({ mcpTabGroups: [{ ...workspace(), description }] }))
    expect(screen.queryByText(description)).not.toBeInTheDocument()
    expect(document.querySelector('.tab-group-label')?.getAttribute('data-tooltip')).toContain(description)
  })

  it('hides a workspace and its tabs only from left navigation without losing its state', async () => {
    const state = browserState({ mcpTabGroups: [{ ...workspace(), hiddenFromSidebar: true }] })
    const view = renderTabs(state, true, 'vertical')
    expect(screen.queryByRole('tab', { name: 'Page first' })).not.toBeInTheDocument()
    expect(document.querySelectorAll('.tab-group-label')).toHaveLength(0)
    expect(state.tabs).toHaveLength(2)
    await view.rerender({ orientation: 'horizontal' })
    expect(screen.getByRole('tab', { name: 'Page first' })).toBeInTheDocument()
    expect(document.querySelectorAll('.tab-group-label')).toHaveLength(1)
  })

  it.each(['horizontal', 'vertical'] as const)('keeps New tab reachable with no workspaces in the %s rail', async orientation => {
    const initial = browserState()
    const view = renderTabs({ ...initial, tabs: [initial.tabs[0]], mcpTabGroups: [] }, true, orientation)
    const create = screen.getByRole('button', { name: /^New tab$/ })
    await fireEvent.click(create)
    expect(view.emitted('newTab')).toEqual([[]])
    await view.rerender({ state: initial })
    expect(screen.queryByRole('button', { name: /^New tab$/ })).toBeNull()
    expect(screen.getByRole('button', { name: /^New tab in Research workspace$/ })).toBeTruthy()
  })

  it('exposes horizontal tablist semantics with the matching arrow-key behavior', () => {
    renderTabs()

    expect(screen.getByRole('tablist', { name: 'Research' })).toHaveAttribute(
      'aria-orientation',
      'horizontal'
    )
  })

  it('uses vertical navigation and scrolling when tabs are placed on the left', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }), true, 'vertical')
    const user = userEvent.setup()
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })
    const tablist = screen.getByRole('tablist', { name: 'Research' })
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })

    expect(strip.closest('.browser-tabs-bar')).toHaveClass('vertical')
    expect(tablist).toHaveAttribute('aria-orientation', 'vertical')
    firstControl.focus()
    await user.keyboard('{ArrowDown}')
    expect(secondControl).toHaveFocus()

    Object.defineProperties(strip, {
      clientHeight: { configurable: true, value: 320 },
      scrollHeight: { configurable: true, value: 1_280 },
      scrollTop: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 120 })
    strip.dispatchEvent(wheel)

    expect(wheel.defaultPrevented).toBe(true)
    expect(strip.scrollTop).toBe(120)
  })

  it('puts the rail pin beside Home and the workspace actions in a Workspaces header', async () => {
    const view = renderTabs(browserState(), true, 'vertical')
    const header = document.querySelector<HTMLElement>('.tab-rail-header')!
    const pin = screen.getByRole('button', { name: 'Collapse tab rail when not in use' })
    expect(header).toContainElement(screen.getByRole('button', { name: 'Open Hronaut Home' }))
    expect(header).toContainElement(pin)
    // The pin is an icon: its name comes from its label, not from a row of text.
    expect(pin).toHaveTextContent('')
    expect(pin).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(pin)
    expect(view.emitted('toggleRailPinned')).toHaveLength(1)

    const workspaces = document.querySelector<HTMLElement>('.workspace-rail-header')!
    expect(workspaces).toHaveTextContent('Workspaces')
    const create = screen.getByRole('button', { name: 'Create workspace' })
    // The search icon finds a workspace; tab search stays on the toolbar's own Search tabs icon.
    const find = screen.getByRole('button', { name: 'Switch workspace' })
    expect(workspaces).toContainElement(create)
    expect(workspaces).toContainElement(find)
    // Moved, not copied: the open rail's strip no longer ends with its own Create workspace row.
    expect(screen.getAllByRole('button', { name: 'Create workspace' })).toHaveLength(1)
    expect(document.querySelector('.tabs-strip')).not.toContainElement(create)
    expect(document.querySelector('.workspace-action-divider')).toBeNull()
    expect(find).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K')
    expect(find).toHaveAttribute('aria-haspopup', 'dialog')
    expect(find).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(find)
    await userEvent.click(create)
    expect(view.emitted('switchWorkspace')).toHaveLength(1)
    // As for the All workspaces row, the switcher gives the focus back here when it closes.
    const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
    find.dispatchEvent(repeat)
    expect(repeat.defaultPrevented).toBe(true)
    expect(view.emitted('createWorkspace')).toHaveLength(1)
    await view.rerender({ workspaceSwitcherOpen: true })
    expect(find).toHaveAttribute('aria-expanded', 'true')
  })

  it('keeps the pin and Create workspace in a folded rail and moves them into the header as it opens', async () => {
    const view = renderTabs(browserState(), true, 'vertical', false)
    const navigation = screen.getByRole('navigation', { name: 'Tab navigation' })
    expect(navigation).toHaveClass('rail-collapsed')
    // Folded, the rail ends with Create workspace as before. Focus opens the rail and replaces this copy, so it stays out
    // of the tab order; the header's own button, hidden by the folded styles, takes over once open.
    const folded = document.querySelector<HTMLElement>('.tabs-strip .new-workspace')!
    expect(folded).toHaveAccessibleName('Create workspace')
    expect(folded).toHaveAttribute('tabindex', '-1')
    expect(document.querySelector('.tabs-strip .workspace-action-divider')).not.toBeNull()
    await userEvent.click(folded)
    expect(view.emitted('createWorkspace')).toHaveLength(1)
    expect(document.querySelector('.tab-rail-header')).toContainElement(screen.getByRole('button', { name: 'Keep tab rail expanded' }))

    await view.rerender({ railRevealed: true })
    expect(navigation).not.toHaveClass('rail-collapsed')
    expect(document.querySelector('.tabs-strip .new-workspace')).toBeNull()
    expect(document.querySelector('.tabs-strip .workspace-action-divider')).toBeNull()
    expect(document.querySelector('.workspace-rail-header')).toContainElement(screen.getByRole('button', { name: 'Create workspace' }))
  })

  it.each(['horizontal', 'vertical'] as const)('marks the %s workspace card holding the page in view', async orientation => {
    const second = { ...workspace('workspace-2'), name: 'Review', color: 'cyan' as const }
    const state = browserState({ mcpTabGroups: [workspace(), second] })
    state.tabs.push(tab('second', { mcpGroupId: second.id, mcpGroupName: second.name }))
    const view = renderTabs(state, true, orientation)
    const card = (name: string) => screen.getByRole('group', { name })
    // Home is in view: no workspace card is the active one.
    expect(card('Research')).not.toHaveClass('active')
    expect(card('Review')).not.toHaveClass('active')

    const showing = (id: string) => ({
      ...state,
      activeTabId: id,
      tabs: state.tabs.map(entry => ({ ...entry, active: entry.id === id }))
    })
    await view.rerender({ state: showing('second') })
    expect(card('Review')).toHaveClass('active')
    expect(card('Research')).not.toHaveClass('active')
    await view.rerender({ state: showing('first') })
    expect(card('Research')).toHaveClass('active')
    expect(card('Review')).not.toHaveClass('active')
    // Settings covers the page, so no workspace is in view, as no tab is selected.
    await view.rerender({ settingsActive: true })
    expect(card('Research')).not.toHaveClass('active')
    expect(card('Research').querySelector('.tab-group-label')).not.toHaveClass('active')
  })

  it('keeps the horizontal strip layout without a Workspaces header', () => {
    renderTabs(browserState(), true, 'horizontal')
    expect(document.querySelector('.workspace-rail-header')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Switch workspace' })).toBeNull()
    expect(screen.queryByRole('button', { name: /tab rail/ })).toBeNull()
    const create = screen.getByRole('button', { name: 'Create workspace' })
    expect(document.querySelector('.tabs-strip')).toContainElement(create)
    expect(create).toHaveTextContent('Workspace')
    expect(create).not.toHaveAttribute('tabindex')
  })

  it('renders the shell reveal state without independently moving pointer or keyboard targets', async () => {
    const view = renderTabs(browserState(), true, 'vertical', false)
    const navigation = screen.getByRole('navigation', { name: 'Tab navigation' })
    const pin = screen.getByRole('button', { name: 'Keep tab rail expanded' })

    expect(navigation).toHaveClass('rail-collapsed')
    expect(pin).toHaveAttribute('aria-pressed', 'false')

    await fireEvent.mouseEnter(navigation)
    expect(navigation).toHaveClass('rail-collapsed')
    await view.rerender({ railRevealed: true })
    expect(navigation).not.toHaveClass('rail-collapsed')

    await fireEvent.mouseLeave(navigation)
    expect(navigation).not.toHaveClass('rail-collapsed')
    await view.rerender({ railRevealed: false })
    expect(navigation).toHaveClass('rail-collapsed')

    pin.focus()
    await fireEvent.focusIn(navigation)
    expect(navigation).toHaveClass('rail-collapsed')
    await fireEvent.click(pin)
    expect(view.emitted('toggleRailPinned')).toEqual([[]])
  })

  it('stays expanded when the surrounding side chrome is being used', async () => {
    const view = renderTabs(browserState(), true, 'vertical', false)
    const navigation = screen.getByRole('navigation', { name: 'Tab navigation' })

    expect(navigation).toHaveClass('rail-collapsed')

    await view.rerender({ railRevealed: true })

    expect(navigation).not.toHaveClass('rail-collapsed')
  })

  it('keeps an explicit selected marker on the active tab in a collapsed rail', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    const view = renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }), true, 'vertical', false)
    const navigation = screen.getByRole('navigation', { name: 'Tab navigation' })
    const firstControl = screen.getByRole('tab', { name: first.title })
    const secondControl = screen.getByRole('tab', { name: second.title })

    expect(navigation).toHaveClass('rail-collapsed')
    expect(firstControl.querySelector('.tab-active-indicator')).toBeInTheDocument()
    expect(secondControl.querySelector('.tab-active-indicator')).not.toBeInTheDocument()

    await view.rerender({
      state: browserState({
        tabs: [{ ...first, active: false }, { ...second, active: true }],
        activeTabId: second.id
      })
    })

    expect(firstControl.querySelector('.tab-active-indicator')).not.toBeInTheDocument()
    expect(secondControl.querySelector('.tab-active-indicator')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').filter((control) => control.getAttribute('aria-selected') === 'true')).toHaveLength(1)
  })

  it('recomputes overflow when the tab position changes its scroll axis', async () => {
    const tabs = Array.from({ length: 9 }, (_, index) => tab(`tab-${index + 1}`))
    const view = renderTabs(browserState({ tabs, activeTabId: tabs[0].id }))
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 1_280 },
      scrollWidth: { configurable: true, value: 1_280 },
      clientHeight: { configurable: true, value: 320 },
      scrollHeight: { configurable: true, value: 1_280 },
      scrollTop: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument()

    await view.rerender({ orientation: 'vertical' })

    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeEnabled())
  })

  it('removes vertical overflow controls when content fits the full rail again', async () => {
    renderTabs(browserState(), true, 'vertical')
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    const shell = strip.closest<HTMLElement>('.tabs-strip-shell')
    if (!shell) throw new Error('Tab strip shell was not found')
    let contentHeight = 500
    Object.defineProperties(shell, {
      clientHeight: { configurable: true, value: 360 }
    })
    Object.defineProperties(strip, {
      clientHeight: {
        configurable: true,
        get: () => shell.classList.contains('has-tab-overflow') ? 296 : 360
      },
      scrollHeight: { configurable: true, get: () => contentHeight },
      scrollTop: { configurable: true, value: 0, writable: true }
    })

    await fireEvent.scroll(strip)
    expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeEnabled()

    contentHeight = 330
    await fireEvent.scroll(strip)

    expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument()
    expect(shell).not.toHaveClass('has-tab-overflow')
  })

  it('removes horizontal overflow controls when content fits the full tab shell again', async () => {
    renderTabs()
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    const shell = strip.closest<HTMLElement>('.tabs-strip-shell')
    if (!shell) throw new Error('Tab strip shell was not found')
    let contentWidth = 600
    Object.defineProperties(shell, {
      clientWidth: { configurable: true, value: 500 }
    })
    Object.defineProperties(strip, {
      clientWidth: {
        configurable: true,
        get: () => shell.classList.contains('has-tab-overflow') ? 438 : 500
      },
      scrollWidth: { configurable: true, get: () => contentWidth },
      scrollLeft: { configurable: true, value: 0, writable: true }
    })

    await fireEvent.scroll(strip)
    expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeEnabled()

    contentWidth = 470
    await fireEvent.scroll(strip)

    expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument()
    expect(shell).not.toHaveClass('has-tab-overflow')
  })

  it('keeps the Home loading indicator separate from labels hidden by compact layouts', () => {
    const loadingHome = tab('home', {
      title: 'Hronaut Home',
      url: 'hronaut://home',
      active: true,
      loading: true,
      navigationGeneration: 0,
      mcpGroupId: undefined,
      mcpGroupName: undefined
    })
    renderTabs(browserState({ tabs: [loadingHome, tab('first')], activeTabId: loadingHome.id }), true, 'vertical', false)

    const home = screen.getByRole('button', { name: 'Open Hronaut Home' })
    expect(home.querySelector('.spinner')).toBeInTheDocument()
    expect(home.querySelector('.spinner')).not.toHaveClass('app-home-label')
    expect(home.querySelector('.app-home-label')).toHaveTextContent('Home')
  })

  it.each([
    { label: 'empty', tabs: [] as BrowserTabState[], activeTabId: null },
    { label: 'populated', tabs: [tab('first')], activeTabId: 'first' }
  ])('requests the same workspace context menu for an $label workspace', async ({ tabs, activeTabId }) => {
    const view = renderTabs(browserState({ tabs, activeTabId }))

    await fireEvent.contextMenu(screen.getByRole('button', { name: /workspace Research/ }))

    expect(view.emitted('showWorkspaceContextMenu')).toEqual([['workspace-1']])
  })

  it('restores and persists collapsed workspaces', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1']))
    renderTabs()
    const user = userEvent.setup()

    const group = screen.getByRole('button', { name: 'Expand workspace Research, 1 tab' })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Page first' })).not.toBeInTheDocument()

    await user.click(group)

    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Page first' })).toBeVisible()
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])
  })

  it('keeps workspace collapse usable when local preference storage cannot be written', async () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('local preferences unavailable')
    })
    renderTabs()

    const group = screen.getByRole('button', { name: 'Collapse workspace Research, 1 tab' })
    await userEvent.setup().click(group)

    expect(group).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Page first' })).not.toBeInTheDocument()
  })

  it('reveals a tab when external activation enters its collapsed workspace', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1']))
    const initial = browserState()
    const view = renderTabs(initial)
    expect(screen.queryByRole('tab', { name: 'Page first' })).not.toBeInTheDocument()

    await view.rerender({
      state: browserState({
        activeTabId: 'first',
        tabs: initial.tabs.map((value) => ({ ...value, active: value.id === 'first' }))
      })
    })

    expect(screen.getByRole('button', { name: 'Collapse workspace Research, 1 tab' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Page first' })).toBeVisible()
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])
  })

  it('reveals the active tab when it moves into a collapsed workspace', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-2']))
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = { ...workspace('workspace-2'), name: 'Hidden QA' }
    const active = tab('active', { active: true })
    const view = renderTabs(browserState({
      tabs: [active],
      activeTabId: active.id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))

    await view.rerender({
      state: browserState({
        tabs: [{
          ...active,
          mcpGroupId: secondWorkspace.id,
          mcpGroupName: secondWorkspace.name
        }],
        activeTabId: active.id,
        mcpTabGroups: [firstWorkspace, secondWorkspace]
      })
    })

    expect(screen.getByRole('button', { name: 'Collapse workspace Hidden QA, 1 tab' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Page active' })).toBeVisible()
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])
  })

  it('reveals the active workspace while preserving unrelated collapse state during hydration', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-1', 'workspace-2']))
    const view = renderTabs(browserState({ tabs: [], activeTabId: null, mcpTabGroups: [] }), false)
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual(['workspace-1', 'workspace-2'])

    const hydrated = browserState()
    const inactiveWorkspace = { ...workspace('workspace-2'), name: 'Background QA' }
    await view.rerender({
      state: browserState({
        activeTabId: 'first',
        tabs: [
          ...hydrated.tabs.map((value) => ({ ...value, active: value.id === 'first' })),
          tab('background', {
            mcpGroupId: inactiveWorkspace.id,
            mcpGroupName: inactiveWorkspace.name
          })
        ],
        mcpTabGroups: [workspace(), inactiveWorkspace]
      }),
      hydrated: true
    })

    expect(screen.getByRole('button', { name: 'Collapse workspace Research, 1 tab' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('tab', { name: 'Page first' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Expand workspace Background QA, 1 tab' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('tab', { name: 'Page background' })).not.toBeInTheDocument()
    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual(['workspace-2'])
  })

  it('removes stale persisted workspace ids on startup', () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['removed-workspace']))

    renderTabs()

    expect(JSON.parse(window.localStorage.getItem('hronaut:collapsed-tab-groups') ?? 'null')).toEqual([])
  })

  it('uses one tab stop and manually activates workspace tabs after arrow-key navigation', async () => {
    const first = tab('first')
    const second = tab('second', { active: true })
    const third = tab('third')
    const view = renderTabs(browserState({
      tabs: [first, second, third],
      activeTabId: second.id
    }))
    const user = userEvent.setup()
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })
    const thirdControl = screen.getByRole('tab', { name: 'Page third' })

    expect(firstControl).toHaveAttribute('tabindex', '-1')
    expect(secondControl).toHaveAttribute('tabindex', '0')
    expect(thirdControl).toHaveAttribute('tabindex', '-1')

    secondControl.focus()
    await user.keyboard('{ArrowRight}')
    expect(thirdControl).toHaveFocus()
    expect(thirdControl).toHaveAttribute('tabindex', '0')
    expect(secondControl).toHaveAttribute('tabindex', '-1')
    expect(view.emitted().selectTab).toBeUndefined()

    await user.keyboard('{ArrowRight}')
    expect(firstControl).toHaveFocus()
    await user.keyboard('{End}')
    expect(thirdControl).toHaveFocus()
    await user.keyboard('{Home}')
    expect(firstControl).toHaveFocus()

    await user.keyboard('{Enter}')
    expect(view.emitted().selectTab).toEqual([['first']])
  })

  it('exposes mute and close shortcuts on the focused tab without nested button roles', async () => {
    const audible = tab('audible', { active: true, audible: true })
    const view = renderTabs(browserState({ tabs: [audible], activeTabId: audible.id }))
    const user = userEvent.setup()
    const control = screen.getByRole('tab', { name: /Page audible/ })

    expect(control).toHaveAttribute('aria-keyshortcuts', 'Delete M')
    expect(control.querySelector('[role="button"]')).not.toBeInTheDocument()

    control.focus()
    await user.keyboard('m')
    await user.keyboard('{Delete}')

    expect(view.emitted('toggleTabMuted')).toEqual([[audible]])
    expect(view.emitted('closeTab')).toEqual([[audible.id]])
  })

  it('closes one tab and toggles mute once while Delete or M is held', () => {
    const audible = tab('audible', { active: true, audible: true })
    const view = renderTabs(browserState({ tabs: [audible, tab('next')], activeTabId: audible.id }))
    const control = screen.getByRole('tab', { name: /Page audible/ })

    for (const key of ['m', 'Delete']) {
      control.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      control.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true, cancelable: true }))
    }

    // A closed tab hands the focus to the next one, so each repeat of a held Delete closed one more tab.
    expect(view.emitted('toggleTabMuted')).toEqual([[audible]])
    expect(view.emitted('closeTab')).toEqual([[audible.id]])
  })

  it('toggles mute with the M key while a Russian, Hebrew or Greek layout types another letter there', () => {
    const audible = tab('audible', { active: true, audible: true })
    const view = renderTabs(browserState({ tabs: [audible], activeTabId: audible.id }))
    const control = screen.getByRole('tab', { name: /Page audible/ })

    // The key that types M on a US keyboard types ь, צ or μ there; a Latin layout's own m stays the key.
    for (const [key, code] of [['ь', 'KeyM'], ['צ', 'KeyM'], ['μ', 'KeyM'], ['m', 'Semicolon'], ['ü', 'KeyM']]) {
      control.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }))
    }

    expect(view.emitted('toggleTabMuted')).toEqual([[audible], [audible], [audible], [audible]])
  })

  it('leaves Delete with a modifier to its shortcut', () => {
    const view = renderTabs(browserState({ tabs: [tab('first', { active: true }), tab('next')], activeTabId: 'first' }))
    const control = screen.getByRole('tab', { name: /Page first/ })

    for (const modifiers of [{ ctrlKey: true, shiftKey: true }, { metaKey: true, shiftKey: true }, { shiftKey: true }, { altKey: true }]) {
      const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true, ...modifiers })
      control.dispatchEvent(event)
      // Ctrl or Cmd with Shift and Delete opens Workspaces & data; it closed the focused tab instead.
      expect(event.defaultPrevented).toBe(false)
    }
    expect(view.emitted('closeTab')).toBeUndefined()
  })

  it('leaves Home, End and the arrows with Alt, Ctrl or Cmd to their shortcuts', async () => {
    renderTabs(browserState({ tabs: [tab('first'), tab('second', { active: true }), tab('third')], activeTabId: 'second' }))
    const control = screen.getByRole('tab', { name: /Page second/ })
    control.focus()
    for (const key of ['Home', 'End', 'ArrowLeft', 'ArrowRight']) {
      for (const modifiers of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })
        control.dispatchEvent(event)
        // Alt+Home moved the keyboard to the first tab instead of opening Home, and Alt+Left to the tab before
        // instead of going back.
        expect(event.defaultPrevented, `${key} ${JSON.stringify(modifiers)}`).toBe(false)
        await nextTick()
        expect(control).toHaveFocus()
      }
    }
  })

  it('keeps the keyboard close shortcut available while website input is locked', async () => {
    const audible = tab('audible', { active: true, audible: true })
    const view = renderTabs(browserState({
      tabs: [audible],
      activeTabId: audible.id,
      allHumanInteractionLocked: true
    }))
    const user = userEvent.setup()
    const control = screen.getByRole('tab', { name: /Page audible/ })

    expect(control).toHaveAttribute('aria-keyshortcuts', 'Delete M')
    control.focus()
    await user.keyboard('{Delete}')
    await user.keyboard('m')

    expect(view.emitted('closeTab')).toEqual([[audible.id]])
    expect(view.emitted('toggleTabMuted')).toEqual([[audible]])
  })

  it('skips collapsed workspace tabs during keyboard navigation and includes them after expansion', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-2']))
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = { ...workspace('workspace-2'), name: 'Hidden QA' }
    const first = tab('first', { active: true })
    const second = tab('second')
    const hidden = tab('hidden', {
      mcpGroupId: secondWorkspace.id,
      mcpGroupName: secondWorkspace.name
    })
    renderTabs(browserState({
      tabs: [first, second, hidden],
      activeTabId: first.id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))
    const user = userEvent.setup()
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })

    firstControl.focus()
    await user.keyboard('{ArrowLeft}')
    expect(secondControl).toHaveFocus()
    expect(screen.queryByRole('tab', { name: 'Page hidden' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand workspace Hidden QA, 1 tab' }))
    const previouslyHidden = screen.getByRole('tab', { name: 'Page hidden' })
    secondControl.focus()
    await user.keyboard('{ArrowRight}')
    expect(previouslyHidden).toHaveFocus()
    expect(previouslyHidden).toHaveAttribute('aria-selected', 'false')
  })

  it('emits midpoint-aware reorder requests but keeps pinned boundaries intact', async () => {
    const first = tab('first')
    const second = tab('second')
    const pinned = tab('pinned', { pinned: true })
    const view = renderTabs(browserState({ tabs: [first, second, pinned], activeTabId: 'first' }))
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })
    const pinnedControl = screen.getByRole('tab', { name: 'Page pinned' })
    vi.spyOn(secondControl, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      width: 100,
      right: 120,
      top: 0,
      bottom: 32,
      height: 32,
      x: 20,
      y: 0,
      toJSON: () => ({})
    })

    await fireEvent.dragStart(firstControl)
    await fireEvent.dragOver(secondControl, { clientX: 90 })
    await fireEvent.drop(secondControl, { clientX: 90 })

    expect(view.emitted().reorderTab).toEqual([[
      { tabId: 'first', targetTabId: 'second', placement: 'after' }
    ]])

    await fireEvent.dragStart(firstControl)
    await fireEvent.dragOver(pinnedControl, { clientX: 0 })
    await fireEvent.drop(pinnedControl, { clientX: 0 })

    expect(view.emitted().reorderTab).toHaveLength(1)
  })

  it('closes a crowded tab with the middle mouse button without activating it', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    const view = renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }))

    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    screen.getByRole('tab', { name: 'Page second' }).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.emitted('closeTab')).toEqual([[second.id]])
    expect(view.emitted('selectTab')).toBeUndefined()
  })

  it('middle-click closes tabs while website interaction is locked', async () => {
    const first = tab('first', { active: true })
    const view = renderTabs(browserState({
      tabs: [first],
      activeTabId: first.id,
      allHumanInteractionLocked: true
    }))

    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 })
    screen.getByRole('tab', { name: 'Page first' }).dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(view.emitted('closeTab')).toEqual([[first.id]])
  })

  it('rejects drag targets from another workspace before showing a drop affordance', async () => {
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = {
      ...workspace('workspace-2'),
      name: 'QA'
    }
    const source = tab('source')
    const otherWorkspaceTarget = tab('target', {
      mcpGroupId: secondWorkspace.id,
      mcpGroupName: secondWorkspace.name
    })
    const view = renderTabs(browserState({
      tabs: [source, otherWorkspaceTarget],
      activeTabId: source.id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))
    const sourceControl = screen.getByRole('tab', { name: 'Page source' })
    const targetControl = screen.getByRole('tab', { name: 'Page target' })
    vi.spyOn(targetControl, 'getBoundingClientRect').mockReturnValue({
      left: 20,
      width: 100,
      right: 120,
      top: 0,
      bottom: 32,
      height: 32,
      x: 20,
      y: 0,
      toJSON: () => ({})
    })

    await fireEvent.dragStart(sourceControl)
    await fireEvent.dragOver(targetControl, { clientX: 90 })

    expect(targetControl).not.toHaveClass('drop-before')
    expect(targetControl).not.toHaveClass('drop-after')

    await fireEvent.drop(targetControl, { clientX: 90 })

    expect(view.emitted().reorderTab).toBeUndefined()
  })

  it('offers explicit controls and mouse-wheel navigation when tabs overflow', async () => {
    const tabs = Array.from({ length: 9 }, (_, index) => tab(`tab-${index + 1}`))
    renderTabs(browserState({ tabs, activeTabId: tabs[0].id }))
    const user = userEvent.setup()
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, value: 1_280 },
      scrollLeft: { configurable: true, value: 0, writable: true }
    })
    const scrollBy = vi.fn(({ left }: ScrollToOptions) => { strip.scrollLeft += left ?? 0 })
    Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })

    await fireEvent.scroll(strip)

    const previous = screen.getByRole('button', { name: 'Show previous tabs' })
    const next = screen.getByRole('button', { name: 'Show more tabs' })
    expect(previous).toBeDisabled()
    expect(next).toBeEnabled()

    await user.click(next)
    expect(scrollBy).toHaveBeenCalledOnce()
    expect(scrollBy.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' })
    expect(scrollBy.mock.calls[0][0].left).toBeCloseTo(230.4)

    const wheel = new WheelEvent('wheel', { cancelable: true, deltaY: 120 })
    strip.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(strip.scrollLeft).toBe(350.4)

    strip.scrollLeft = 960
    await fireEvent.scroll(strip)
    expect(previous).toBeEnabled()
    expect(next).toBeDisabled()

    Object.defineProperty(strip, 'scrollWidth', { configurable: true, value: 280 })
    await user.click(screen.getByRole('button', { name: 'Collapse workspace Research, 9 tabs' }))
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show previous tabs' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument()
    })
  })

  it('recomputes overflow when tabs move into a collapsed workspace', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-2']))
    const firstWorkspace = workspace('workspace-1')
    const secondWorkspace = { ...workspace('workspace-2'), name: 'Hidden QA' }
    const tabs = Array.from({ length: 9 }, (_, index) => tab(`tab-${index + 1}`))
    const view = renderTabs(browserState({
      tabs,
      activeTabId: tabs[0].id,
      mcpTabGroups: [firstWorkspace, secondWorkspace]
    }))
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    let contentWidth = 1_280
    Object.defineProperties(strip, {
      clientWidth: { configurable: true, value: 320 },
      scrollWidth: { configurable: true, get: () => contentWidth },
      scrollLeft: { configurable: true, value: 0, writable: true }
    })
    await fireEvent.scroll(strip)
    expect(screen.getByRole('button', { name: 'Show more tabs' })).toBeVisible()

    contentWidth = 280
    await view.rerender({
      state: browserState({
        tabs: tabs.map((value, index) => index === 0 ? value : ({
          ...value,
          mcpGroupId: secondWorkspace.id,
          mcpGroupName: secondWorkspace.name
        })),
        activeTabId: tabs[0].id,
        mcpTabGroups: [firstWorkspace, secondWorkspace]
      })
    })

    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Show previous tabs' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Show more tabs' })).not.toBeInTheDocument()
    })
  })

  it('preserves a deliberately scrolled-away position during a passive rail resize', async () => {
    let resize: (() => void) | undefined
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe(): void {}
      disconnect(): void {}
    })
    try {
      const active = tab('active', { active: true })
      renderTabs(browserState({ tabs: [active, tab('later')], activeTabId: active.id }), true, 'vertical', false)
      await nextTick()
      const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
      const selected = screen.getByRole('tab', { name: active.title })
      const scrollBy = vi.fn()
      Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })
      vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 56, 200))
      vi.spyOn(selected, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, -100, 34, 29))
      await fireEvent.scroll(strip)
      resize!()
      expect(scrollBy).not.toHaveBeenCalled()
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
  })

  it.each(['horizontal', 'vertical'] as const)('reveals the active %s tab after a resize-driven scroll', async orientation => {
    let resize: (() => void) | undefined
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe(): void {}
      disconnect(): void {}
    })
    try {
      const active = tab('active', { active: true })
      renderTabs(browserState({ tabs: [active], activeTabId: active.id }), true, orientation)
      await nextTick()
      const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
      const selected = screen.getByRole('tab', { name: active.title })
      const scrollBy = vi.fn()
      let extent = 400
      Object.defineProperties(strip, {
        clientWidth: { configurable: true, get: () => extent },
        clientHeight: { configurable: true, get: () => extent },
        scrollBy: { configurable: true, value: scrollBy }
      })
      vi.spyOn(strip, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, extent, extent))
      vi.spyOn(selected, 'getBoundingClientRect').mockReturnValue(new DOMRect(250, 250, 34, 34))
      resize!()
      scrollBy.mockClear()
      // Chromium can dispatch a scroll caused by layout before ResizeObserver.
      // The previously visible selection is now outside the smaller viewport.
      extent = 200
      await fireEvent.scroll(strip)
      resize!()
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining(orientation === 'vertical' ? { top: 122 } : { left: 115 }))
    } finally { vi.restoreAllMocks(); vi.unstubAllGlobals() }
  })

  it('reveals a newly active tab inside the scrolling strip', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const initial = browserState()
      const view = renderTabs(initial)

      await view.rerender({
        state: browserState({
          activeTabId: 'first',
          tabs: initial.tabs.map((value) => ({ ...value, active: value.id === 'first' }))
        })
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
      })
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it.each(['resize', 'title update'] as const)('preserves the actual keyboard target after a passive %s', async (change) => {
    let resize: (() => void) | undefined
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback }
      observe(): void {}
      disconnect(): void {}
    })
    try {
      const first = tab('first')
      const focused = tab('focused')
      const active = tab('active', { active: true })
      const initial = browserState({ tabs: [first, focused, active], activeTabId: active.id })
      const view = renderTabs(initial, true, 'vertical', false)
      await nextTick()
      const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
      const focusedControl = screen.getByRole('tab', { name: focused.title })
      const activeControl = screen.getByRole('tab', { name: active.title })
      const revealFocused = vi.fn()
      const scrollBy = vi.fn()
      Object.defineProperty(focusedControl, 'scrollIntoView', { configurable: true, value: revealFocused })
      Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })
      vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 280, 200))
      vi.spyOn(focusedControl, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 50, 240, 29))
      // A partly visible active tab must not displace the actual keyboard target.
      vi.spyOn(activeControl, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 190, 240, 29))
      await fireEvent.keyDown(screen.getByRole('tab', { name: first.title }), { key: 'ArrowDown' })
      expect(focusedControl).toHaveFocus()
      revealFocused.mockClear()
      scrollBy.mockClear()
      if (change === 'resize') resize!()
      else await view.rerender({ state: { ...initial, tabs: [first, { ...focused, title: 'Loaded document title' }, active] } })
      await nextTick()
      expect(focusedControl).toHaveFocus()
      expect(revealFocused).toHaveBeenCalled()
      expect(scrollBy).not.toHaveBeenCalled()

      // A genuine selection change must still reveal the selected page even
      // while the keyboard target remains focused.
      vi.spyOn(screen.getByRole('tab', { name: first.title }), 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 50, 240, 29))
      const revealSelection = vi.fn()
      Object.defineProperty(screen.getByRole('tab', { name: first.title }), 'scrollIntoView', { configurable: true, value: revealSelection })
      await view.rerender({ state: { ...initial, activeTabId: first.id, tabs: [{ ...first, active: true }, focused, { ...active, active: false }] } })
      await nextTick()
      expect(revealSelection).toHaveBeenCalled()
      revealSelection.mockClear()
      resize!()
      expect(revealSelection).toHaveBeenCalled()

      // Move focus away and back so the focus handler records a fresh keyboard
      // target distinct from the active tab before the native window blurs.
      screen.getByRole('tab', { name: first.title }).focus()
      focusedControl.focus()
      hasFocus.mockReturnValue(false)
      revealSelection.mockClear()
      resize!()
      expect(revealSelection).toHaveBeenCalled()
    } finally {
      hasFocus.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('keeps keyboard-focused tabs clear of their sticky workspace name', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }))
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    const secondControl = screen.getByRole('tab', { name: second.title })
    const header = screen.getByRole('button', { name: 'Collapse workspace Research, 2 tabs' })
    const scrollBy = vi.fn()
    Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 200, 37))
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 4, 74, 29))
    vi.spyOn(secondControl, 'getBoundingClientRect').mockReturnValue(new DOMRect(110, 4, 112, 29))
    await fireEvent.keyDown(screen.getByRole('tab', { name: first.title }), { key: 'ArrowRight' })
    await vi.waitFor(() => {
      expect(secondControl).toHaveFocus()
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -66 }))
    })
  })

  it.each([
    { width: 231, expectedLeft: 88, trailing: 31 },
    { width: 230, expectedLeft: 88, trailing: 30 },
    { width: 220, expectedLeft: 88, trailing: 20 },
    { width: 250, expectedLeft: 90, trailing: 48 }
  ])('keeps sticky header separation and available trailing clearance in a $width pixel strip', async ({ width, expectedLeft, trailing }) => {
    const first = tab('first', { active: true })
    const second = tab('second')
    renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }))
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    const target = screen.getByRole('tab', { name: second.title })
    const header = screen.getByRole('button', { name: /Collapse workspace Research/ })
    await fireEvent.scroll(strip)
    let left = 5
    Object.defineProperty(strip, 'scrollBy', { configurable: true, value: ({ left: delta }: { left: number }) => { left -= delta } })
    vi.spyOn(strip, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 37))
    vi.spyOn(header, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 4, 86, 29))
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => new DOMRect(left, 4, 112, 29))
    await fireEvent.keyDown(screen.getByRole('tab', { name: first.title }), { key: 'ArrowRight' })
    await vi.waitFor(() => expect(target).toHaveFocus())
    expect(left).toBe(expectedLeft)
    expect(left).toBeGreaterThanOrEqual(88)
    expect(width - left - 112).toBeGreaterThanOrEqual(trailing)
  })

  it('reserves vertical workspace header height when revealing a keyboard tab', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }), true, 'vertical')
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    const target = screen.getByRole('tab', { name: second.title })
    const header = screen.getByRole('button', { name: /Collapse workspace Research/ })
    const scrollBy = vi.fn()
    Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 250, 180))
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(5, 100, 240, 28))
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 110, 230, 34))
    await fireEvent.keyDown(screen.getByRole('tab', { name: first.title }), { key: 'ArrowDown' })
    await vi.waitFor(() => {
      expect(target).toHaveFocus()
      // Keep the target below the 28px sticky header and reserve a complete
      // neighboring 34px row plus its gap when the strip has room.
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: -28 }))
    })
  })

  it('keeps a newly active crowded tab clear of the fixed scroll controls', async () => {
    const first = tab('first', { active: true })
    const second = tab('second')
    const view = renderTabs(browserState({ tabs: [first, second], activeTabId: first.id }))
    const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
    const secondControl = screen.getByRole('tab', { name: second.title })
    const scrollBy = vi.fn()
    Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })
    vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue({
      left: 100, right: 500, top: 0, bottom: 40, width: 400, height: 40, x: 100, y: 0, toJSON: () => ({})
    })
    vi.spyOn(secondControl, 'getBoundingClientRect').mockReturnValue({
      left: 470, right: 590, top: 0, bottom: 40, width: 120, height: 40, x: 470, y: 0, toJSON: () => ({})
    })

    await view.rerender({
      state: browserState({
        tabs: [{ ...first, active: false }, { ...second, active: true }],
        activeTabId: second.id
      })
    })

    await vi.waitFor(() => {
      expect(scrollBy).toHaveBeenCalledWith({ left: 121, behavior: 'auto' })
    })
  })

  it('reveals the active tab immediately when the strip moves to the left rail', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const active = tab('active', { active: true })
      const view = renderTabs(browserState({ tabs: [active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()

      await view.rerender({ orientation: 'vertical' })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
      })
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('keeps the active crowded tab revealed when an earlier pinned tab expands', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const first = tab('first', { pinned: true })
      const active = tab('active', { active: true })
      const view = renderTabs(browserState({ tabs: [first, active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()

      await view.rerender({
        state: browserState({
          tabs: [{ ...first, pinned: false }, active],
          activeTabId: active.id
        })
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
      })
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('keeps a partially visible active tab revealed when earlier tabs expand', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const first = tab('first', { pinned: true })
      const active = tab('active', { active: true })
      const view = renderTabs(browserState({ tabs: [first, active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()
      vi.spyOn(screen.getByRole('group', { name: 'Browser tabs and workspaces' }), 'getBoundingClientRect').mockReturnValue({
        left: 0, right: 320, top: 0, bottom: 40, width: 320, height: 40, x: 0, y: 0, toJSON: () => ({})
      })
      vi.spyOn(screen.getByRole('tab', { name: active.title }), 'getBoundingClientRect').mockReturnValue({
        left: 280, right: 400, top: 0, bottom: 40, width: 120, height: 40, x: 280, y: 0, toJSON: () => ({})
      })

      await view.rerender({
        state: browserState({
          tabs: [{ ...first, pinned: false }, active],
          activeTabId: active.id
        })
      })

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
      })
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('does not steal a crowded strip the user scrolled away from the active tab', async () => {
    const scrollIntoView = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const first = tab('first', { pinned: true })
      const active = tab('active', { active: true })
      const view = renderTabs(browserState({ tabs: [first, active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()
      vi.spyOn(screen.getByRole('group', { name: 'Browser tabs and workspaces' }), 'getBoundingClientRect').mockReturnValue({
        left: 0, right: 320, top: 0, bottom: 40, width: 320, height: 40, x: 0, y: 0, toJSON: () => ({})
      })
      vi.spyOn(screen.getByRole('tab', { name: active.title }), 'getBoundingClientRect').mockReturnValue({
        left: 500, right: 620, top: 0, bottom: 40, width: 120, height: 40, x: 500, y: 0, toJSON: () => ({})
      })

      await view.rerender({
        state: browserState({
          tabs: [{ ...first, pinned: false }, active],
          activeTabId: active.id
        })
      })
      await nextTick()

      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', original)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it.each(['tab', 'add', 'workspace'] as const)('keeps the focused %s visible when the vertical rail resizes', async (target) => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    let resizeCallback: ResizeObserverCallback | undefined
    const scrollIntoView = vi.fn()
    const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const first = tab('first')
      const active = tab('active', { active: true })
      renderTabs(browserState({ tabs: [first, active], activeTabId: active.id }), true, 'vertical', false)
      await vi.waitFor(() => expect(resizeCallback).toBeDefined())
      const control = target === 'tab'
        ? screen.getByRole('tab', { name: first.title })
        : target === 'add'
          ? screen.getByRole('button', { name: 'New tab in Research workspace' })
          : screen.getByRole('button', { name: /Collapse workspace Research/ })
      control.focus()
      await nextTick()
      scrollIntoView.mockClear()

      resizeCallback!([], {} as ResizeObserver)
      expect(scrollIntoView.mock.instances).toEqual([control])
      expect(control).toHaveFocus()
      expect(screen.getByRole('tab', { name: active.title })).toHaveAttribute('aria-selected', 'true')
    } finally {
      hasFocus.mockRestore()
      vi.unstubAllGlobals()
      if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })

  it('does not scroll a visible sticky workspace header away from its leading edge on resize', async () => {
    let resizeCallback: ResizeObserverCallback | undefined
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resizeCallback = callback }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    })
    try {
      renderTabs(browserState(), true, 'vertical')
      await vi.waitFor(() => expect(resizeCallback).toBeDefined())
      const strip = screen.getByRole('group', { name: 'Browser tabs and workspaces' })
      const header = screen.getByRole('button', { name: /Collapse workspace Research/ })
      const scrollBy = vi.fn()
      Object.defineProperty(strip, 'scrollBy', { configurable: true, value: scrollBy })
      vi.spyOn(strip, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 250, 180))
      vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(5, 100, 240, 28))
      header.focus()
      await nextTick()
      scrollBy.mockClear()
      resizeCallback!([], {} as ResizeObserver)
      expect(header).toHaveFocus()
      expect(scrollBy).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reveals the active tab again when the scrolling strip is resized', async () => {
    const originalResizeObserver = Object.getOwnPropertyDescriptor(window, 'ResizeObserver')
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
    const scrollIntoView = vi.fn()
    let resizeCallback: ResizeObserverCallback | undefined
    let resizeObserver: ResizeObserver | undefined

    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
        resizeObserver = this
      }

      disconnect(): void {}
      observe(): void {}
      unobserve(): void {}
    }

    Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: TestResizeObserver })
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })
    try {
      const active = tab('active', { active: true })
      renderTabs(browserState({ tabs: [active], activeTabId: active.id }))
      await vi.waitFor(() => expect(scrollIntoView).toHaveBeenCalled())
      scrollIntoView.mockClear()

      resizeCallback?.([], resizeObserver!)

      await vi.waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest', inline: 'nearest' })
      })
    } finally {
      if (originalResizeObserver) Object.defineProperty(window, 'ResizeObserver', originalResizeObserver)
      else Reflect.deleteProperty(window, 'ResizeObserver')
      if (originalScrollIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView)
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
    }
  })
})

describe('BrowserTabsBar keyboard focus when the focused tab closes', () => {
  const tabs = () => [tab('first', { active: true }), tab('second'), tab('third')]

  // Delete closed the focused tab, its control left the strip and the focus fell to the page body, so the next arrow
  // key did nothing and the next Tab started at the top of the window. The tab after it now takes the focus, or the
  // one before it when it was the last, as the tabs pattern asks.
  it.each([
    ['second', 'third'],
    ['third', 'second']
  ])('moves the focus from %s to %s once Delete has closed it', async (closed, next) => {
    const view = renderTabs(browserState({ tabs: tabs(), activeTabId: 'first' }))
    screen.getByRole('tab', { name: `Page ${closed}` }).focus()
    await userEvent.setup().keyboard('{Delete}')
    expect(view.emitted('closeTab')).toEqual([[closed]])

    await view.rerender({ state: browserState({ tabs: tabs().filter((candidate) => candidate.id !== closed), activeTabId: 'first' }) })
    await flushPromises()

    const target = screen.getByRole('tab', { name: `Page ${next}` })
    expect(target).toHaveFocus()
    expect(target).toHaveAttribute('tabindex', '0')
  })

  // Moving the focused tab, as with Move left or Pin from its menu, moves its control, which drops its focus to the page
  // body in Chromium as in this test.
  it('keeps the focus on a tab that moved within the strip', async () => {
    const view = renderTabs(browserState({ tabs: tabs(), activeTabId: 'first' }))
    const third = screen.getByRole('tab', { name: 'Page third' })
    third.focus()
    const [first, second, last] = tabs()
    await view.rerender({ state: browserState({ tabs: [first, last, second], activeTabId: 'first' }) })
    await flushPromises()
    expect(screen.getByRole('tab', { name: 'Page third' })).toHaveFocus()
  })

  it('keeps the focus on a tab that moved to another workspace in view', async () => {
    const other = { ...workspace('workspace-2'), name: 'QA' }
    const withOther = (list: BrowserTabState[]) => browserState({ tabs: list, activeTabId: 'first', mcpTabGroups: [workspace(), other] })
    const view = renderTabs(withOther(tabs()))
    screen.getByRole('tab', { name: 'Page second' }).focus()
    await view.rerender({ state: withOther(tabs().map((candidate) => candidate.id === 'second' ? { ...candidate, mcpGroupId: other.id, mcpGroupName: other.name } : candidate)) })
    await flushPromises()
    expect(screen.getByRole('tab', { name: 'Page second' })).toHaveFocus()
  })

  // A tab that is only hidden still exists, so no tab of another workspace takes its focus.
  it('gives no other tab the focus of a tab moved into a folded workspace', async () => {
    window.localStorage.setItem('hronaut:collapsed-tab-groups', JSON.stringify(['workspace-2']))
    const other = { ...workspace('workspace-2'), name: 'QA' }
    const withOther = (list: BrowserTabState[]) => browserState({ tabs: list, activeTabId: 'first', mcpTabGroups: [workspace(), other] })
    const view = renderTabs(withOther(tabs()))
    screen.getByRole('tab', { name: 'Page second' }).focus()
    await view.rerender({ state: withOther(tabs().map((candidate) => candidate.id === 'second' ? { ...candidate, mcpGroupId: other.id, mcpGroupName: other.name } : candidate)) })
    await flushPromises()
    expect(screen.queryByRole('tab', { name: 'Page second' })).toBeNull()
    expect(document.body).toHaveFocus()
  })

  it('leaves the focus alone when it moved on before the tab closed', async () => {
    const view = renderTabs(browserState({ tabs: tabs(), activeTabId: 'first' }))
    const external = document.createElement('button')
    document.body.append(external)
    try {
      screen.getByRole('tab', { name: 'Page second' }).focus()
      external.focus()
      await view.rerender({ state: browserState({ tabs: tabs().filter((candidate) => candidate.id !== 'second'), activeTabId: 'first' }) })
      await flushPromises()
      expect(external).toHaveFocus()
    } finally { external.remove() }
  })

  it('does not take the focus back while the window does not have it, as after the page took it', async () => {
    const view = renderTabs(browserState({ tabs: tabs(), activeTabId: 'first' }))
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    try {
      screen.getByRole('tab', { name: 'Page second' }).focus()
      await view.rerender({ state: browserState({ tabs: tabs().filter((candidate) => candidate.id !== 'second'), activeTabId: 'first' }) })
      await flushPromises()
      expect(document.body).toHaveFocus()
    } finally { hasFocus.mockRestore() }
  })
})

describe('BrowserTabsBar drop marker while dragging a tab', () => {
  function bounds(control: HTMLElement): void {
    vi.spyOn(control, 'getBoundingClientRect').mockReturnValue({
      left: 20, width: 100, right: 120, top: 0, bottom: 32, height: 32, x: 20, y: 0, toJSON: () => ({})
    })
  }

  // The marker beside the last tab you could drop on stayed while you dragged back over the tab itself, or over a tab
  // in another workspace or across the pinned boundary, so it looked as if dropping there would move the tab beside
  // that last tab, and then nothing happened.
  it.each(['the dragged tab', 'a pinned tab', 'a tab in another workspace'])('clears the marker over %s, where the tab cannot be dropped', async (over) => {
    const other = { ...workspace('workspace-2'), name: 'QA' }
    const first = tab('first', { active: true })
    const second = tab('second')
    const pinned = tab('pinned', { pinned: true })
    const elsewhere = tab('elsewhere', { mcpGroupId: other.id, mcpGroupName: other.name })
    const view = renderTabs(browserState({ tabs: [pinned, first, second, elsewhere], activeTabId: first.id, mcpTabGroups: [workspace(), other] }))
    const firstControl = screen.getByRole('tab', { name: 'Page first' })
    const secondControl = screen.getByRole('tab', { name: 'Page second' })
    const rejected = screen.getByRole('tab', { name: over === 'the dragged tab' ? 'Page first' : over === 'a pinned tab' ? 'Page pinned' : 'Page elsewhere' })
    bounds(secondControl)
    bounds(rejected)

    await fireEvent.dragStart(firstControl)
    await fireEvent.dragOver(secondControl, { clientX: 90 })
    expect(secondControl).toHaveClass('drop-after')

    await fireEvent.dragOver(rejected, { clientX: 90 })
    expect(secondControl).not.toHaveClass('drop-after')
    expect(view.container.querySelector('.drop-before, .drop-after')).toBeNull()

    await fireEvent.drop(rejected, { clientX: 90 })
    expect(view.emitted().reorderTab).toBeUndefined()
  })
})
