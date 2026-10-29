import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import AgentStepsDialog from '../../src/renderer/src/features/agents/AgentStepsDialog.vue'
import { useAgentStepHistory } from '../../src/renderer/src/features/agents/useAgentStepHistory.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type {
  AgentPresence,
  AgentPresenceSnapshot,
  AgentStepHistoryEntry,
  AgentStepHistoryRequest,
  HronautAgentPresenceApi
} from '../../src/shared/agent-presence.js'
import type { BrowserState } from '../../src/shared/types.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'

const clientKey = 'AbCdEfGhIjKlMnOpQrSt-_'
const target = { clientKey, workspaceId: 'shop' }
const picture = 'data:image/jpeg;base64,/9j/AA=='

function agent(overrides: Partial<AgentPresence> = {}): AgentPresence {
  return { clientKey, name: 'Claude Code', initial: 'C', colorIndex: 2, state: 'working', step: 'click', recentSteps: [], ...overrides }
}

function browserState(): BrowserState {
  return {
    activeTabId: 'tab-1',
    tabs: [
      { id: 'tab-1', title: 'Checkout', url: 'https://shop.example/checkout', mcpGroupId: 'shop' },
      { id: 'tab-2', title: '', url: 'http://localhost:5173/cart', mcpGroupId: 'shop' }
    ],
    mcpTabGroups: [{ id: 'shop', name: 'Shop' }]
  } as unknown as BrowserState
}

// Newest first, as main sends them: two steps on the checkout tab, one on no tab, one on a tab that left, one on the cart.
function history(): AgentStepHistoryEntry[] {
  return [
    { id: 's5', step: 'click', target: 'Review order', outcome: 'done', at: 5_000, tabId: 'tab-1', thumbnail: { width: 320, height: 200, dataUrl: picture } },
    { id: 's4', step: 'type', target: 'Email', outcome: 'failed', at: 4_000, tabId: 'tab-1' },
    { id: 's3', step: 'working', outcome: 'done', at: 3_000 },
    { id: 's2', step: 'navigate', target: 'old.example/login', outcome: 'done', at: 2_000, tabClosed: true },
    { id: 's1', step: 'navigate', target: 'localhost:5173/cart', outcome: 'done', at: 1_000, tabId: 'tab-2' }
  ]
}

function presence(steps: (request: AgentStepHistoryRequest) => Promise<AgentStepHistoryEntry[] | null>) {
  let listener: ((snapshot: AgentPresenceSnapshot) => void) | undefined
  let revision = 1
  let workspaces: AgentPresenceSnapshot['workspaces'] = { shop: [agent()] }
  const api = {
    get: vi.fn(async () => ({ revision, workspaces })),
    onChanged: (next: (snapshot: AgentPresenceSnapshot) => void) => { listener = next; return () => { listener = undefined } },
    steps: vi.fn(steps)
  } satisfies HronautAgentPresenceApi
  return {
    api,
    publish: (next: AgentPresenceSnapshot['workspaces'] = workspaces) => {
      workspaces = next
      listener?.({ revision: ++revision, workspaces })
    }
  }
}

let wrapper: VueWrapper | undefined
afterEach(() => {
  vi.restoreAllMocks()
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

function mountDialog(api: HronautAgentPresenceApi, props: Record<string, unknown> = {}) {
  const selectTab = vi.fn(async () => undefined)
  const showError = vi.fn()
  wrapper = mount(AgentStepsDialog, {
    attachTo: document.body,
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      'onUpdate:open': (open: boolean) => { void wrapper?.setProps({ open }) },
      target,
      state: browserState(),
      selectTab,
      formatTime: (value: Date | number | string) => `at ${Number(value)}`,
      formatNumber: String,
      formatError: (_cause: unknown, fallback: string) => fallback,
      showError,
      presenceApi: api,
      ...props
    }
  })
  return { selectTab, showError }
}

describe('All steps', () => {
  it('lists the agent\'s steps newest first in runs per tab, with the page after each step', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { api } = presence(async () => history())
    const { selectTab } = mountDialog(api)
    await flushPromises()
    const dialog = screen.getByRole('dialog', { name: 'Steps by Claude Code' })
    expect(dialog).toHaveAccessibleDescription('Up to 20 of its latest steps in Shop, newest first.')
    // Focus moves into it, so it is announced and the keyboard starts there.
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(api.steps).toHaveBeenCalledWith({ clientKey, workspaceId: 'shop', known: [] })
    const groups = within(dialog).getAllByRole('region')
    expect(groups.map((group) => group.getAttribute('aria-labelledby') && within(group).getByRole('heading').textContent)).toEqual([
      'Checkout', 'Not on a tab', 'A tab no longer in this workspace', 'localhost:5173'
    ])
    const checkout = within(groups[0]).getAllByRole('listitem')
    expect(checkout.map((item) => [item.querySelector('.agent-steps-text')?.textContent?.trim(), item.querySelector('time')?.textContent])).toEqual([
      ['Clicked “Review order”', 'at 5000'],
      ['Typed in Email, failed', 'at 4000']
    ])
    // The picture is decorative next to its step's words; a tab step without one keeps its place.
    const image = checkout[0].querySelector('img')!
    expect(image.getAttribute('src')).toBe(picture)
    expect(image.getAttribute('alt')).toBe('')
    expect(checkout[1].querySelector('.agent-steps-picture--none')).not.toBeNull()
    expect(within(groups[1]).getByRole('listitem').querySelector('.agent-steps-picture')).toBeNull()
    expect(checkout[1]).toHaveAttribute('data-outcome', 'failed')
    expect(checkout[0].querySelector('time')).toHaveAttribute('datetime', new Date(5_000).toISOString())
    // Only tabs still open can be shown.
    expect(within(groups[1]).queryByRole('button')).toBeNull()
    expect(within(groups[2]).queryByRole('button')).toBeNull()
    await userEvent.setup().click(within(groups[3]).getByRole('button', { name: 'Show tab localhost:5173' }))
    expect(selectTab).toHaveBeenCalledWith('tab-2')
    await nextTick()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reads again when presence changes, without sending pictures it already has, and keeps the last steps once the agent left', async () => {
    let answer: AgentStepHistoryEntry[] | null = history()
    const { api, publish } = presence(async () => answer)
    mountDialog(api)
    await flushPromises()
    answer = [{ ...history()[0], id: 's6', at: 6_000, thumbnail: undefined }, { ...history()[0], thumbnail: { width: 320, height: 200 } }]
    publish()
    await flushPromises()
    expect(api.steps).toHaveBeenLastCalledWith({ clientKey, workspaceId: 'shop', known: ['s5'] })
    // The picture it already had stays on its step.
    expect(document.querySelectorAll('img')).toHaveLength(1)
    expect(document.querySelector('img')?.getAttribute('src')).toBe(picture)

    answer = null
    publish({})
    await flushPromises()
    expect(screen.getByRole('status')).toHaveTextContent('Claude Code is no longer working in this workspace. These were its last steps.')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'Steps by Claude Code' })).toBeTruthy()
  })

  it('says when the steps could not be read, and reads them again on request', async () => {
    let fail = true
    const { api } = presence(async () => {
      if (fail) throw new Error('read failed')
      return history()
    })
    mountDialog(api)
    await flushPromises()
    expect(screen.getByRole('status')).toHaveTextContent('Could not load these steps.')
    expect(screen.queryByText('No finished steps yet')).toBeNull()
    fail = false
    const reads = api.steps.mock.calls.length
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    await flushPromises()
    expect(api.steps).toHaveBeenCalledTimes(reads + 1)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('says when there are no steps yet, and reports a tab it could not show', async () => {
    const { api } = presence(async () => [])
    mountDialog(api)
    await flushPromises()
    expect(screen.getByText('No finished steps yet')).toBeTruthy()
    expect(screen.getByText('Steps appear here as Claude Code works.')).toBeTruthy()
    wrapper!.unmount()

    const second = presence(async () => history())
    const { selectTab, showError } = mountDialog(second.api)
    selectTab.mockRejectedValueOnce(new Error('closed'))
    await flushPromises()
    await userEvent.setup().click(screen.getAllByRole('button', { name: /^Show tab/u })[0])
    await flushPromises()
    expect(showError).toHaveBeenCalledWith('Could not show the tab', 'The tab may have closed.')
  })

  it('has every phrase in every language', () => {
    const keys = ['kicker', 'heading', 'close', 'summary', 'summaryNoWorkspace', 'ended', 'loadFailed', 'retry', 'closedTab', 'noTab', 'untitledTab',
      'showTab', 'showTabNamed', 'showTabFailed', 'showTabFailedDescription', 'empty', 'emptyDescription', 'privacy']
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale).global
      for (const key of keys) {
        expect(i18n.te(`agentSteps.${key}`, locale), `${locale} ${key}`).toBe(true)
      }
      expect(i18n.t('agentSteps.summary', { count: '20', workspace: 'Zws' }), locale).toMatch(/20.*Zws|Zws.*20/u)
      expect(i18n.t('agentSteps.heading', { name: 'Zname' }), locale).toContain('Zname')
      expect(i18n.t('agentSteps.showTabNamed', { title: 'Ztitle' }), locale).toContain('Ztitle')
      // The button's name starts with the words it shows.
      expect(i18n.t('agentSteps.showTabNamed', { title: 'Ztitle' }), locale).toContain(i18n.t('agentSteps.showTab'))
    }
  })
})

describe('agent step history', () => {
  it('keeps only the newest read, and starts over for another agent', async () => {
    const reads: Array<{ request: AgentStepHistoryRequest; resolve: (value: AgentStepHistoryEntry[] | null) => void }> = []
    const api = { steps: vi.fn((request: AgentStepHistoryRequest) => new Promise<AgentStepHistoryEntry[] | null>((resolve) => { reads.push({ request, resolve }) })) }
    const current = ref<typeof target | null>(target)
    const revision = ref(1)
    const scope = effectScope()
    const view = scope.run(() => useAgentStepHistory({ api, target: () => current.value, revision: () => revision.value }))!
    await nextTick()
    revision.value = 2
    await nextTick()
    expect(reads).toHaveLength(2)
    // The newer read answers first; the older one arriving late changes nothing.
    reads[1].resolve([history()[4]])
    await flushPromises()
    reads[0].resolve(history())
    await flushPromises()
    expect(view.steps.value.map((step) => step.id)).toEqual(['s1'])

    // Another agent starts from nothing, and a late answer for the first agent is dropped.
    revision.value = 3
    await nextTick()
    current.value = { clientKey: 'ZyXwVuTsRqPoNmLkJiHgFe', workspaceId: 'shop' }
    expect(view.steps.value).toEqual([])
    expect(view.loaded.value).toBe(false)
    await nextTick()
    reads[2].resolve(history())
    await flushPromises()
    expect(view.steps.value).toEqual([])
    expect(reads[3].request).toEqual({ clientKey: 'ZyXwVuTsRqPoNmLkJiHgFe', workspaceId: 'shop', known: [] })
    reads[3].resolve([])
    await flushPromises()
    expect(view.loaded.value).toBe(true)

    // Closed, it reads nothing more.
    current.value = null
    revision.value = 4
    await nextTick()
    expect(reads).toHaveLength(4)
    scope.stop()
    view.dispose()
  })
})
