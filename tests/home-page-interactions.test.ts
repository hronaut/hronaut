// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHomePage } from '../src/main/home-page.js'
import type { McpDashboardState } from '../src/main/mcp/server.js'

const state: McpDashboardState = {
  name: 'hronaut', version: '1.11.50', endpoint: 'http://127.0.0.1:47812/mcp',
  startedAt: '2026-09-04T12:00:00.000Z', activeRequests: 0, totalRequests: 0,
  paused: false, status: 'ready', completedToolCalls: 0, clients: [],
  recentActivity: [], toolMetrics: [], tools: []
}

function mount(bridge: Record<string, unknown> = {}) {
  const html = renderHomePage({ endpoint: state.endpoint, initialState: state, locale: 'en-US' })
  document.documentElement.innerHTML = html
  Object.defineProperty(window, 'hronautHome', { configurable: true, value: bridge })
  const script = document.querySelector('script')!.textContent!
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => state })
  return new Function('window', 'document', 'fetch', 'setTimeout', script + '\nreturn { update(next) { dashboard = next; renderDashboard(); } };')(window, document, fetch, setTimeout) as { update(next: McpDashboardState): void }
}

const button = (selector: string) => document.querySelector<HTMLButtonElement>(selector)!
async function settle() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

const localStorageDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
beforeEach(() => {
  vi.useFakeTimers()
  const values = new Map<string, string>()
  const storage: Storage = {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, String(value)) }
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.documentElement.innerHTML = ''
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
})

describe('Home action recovery', () => {
  for (const [selector, method, status] of [
    ['[data-agent-guide]', 'openAgentGuide', '#guide-open-status'],
    ['[data-setup-help]', 'openSetupHelp', '#support-help-status'],
    ['[data-setup-feedback]', 'openSetupFeedback', '#support-feedback-status']
  ] as const) {
    it(`shows visible accessible failure and permits retry for ${method}`, async () => {
      const action = vi.fn().mockRejectedValueOnce(new Error('Launch rejected')).mockResolvedValue(undefined)
      mount({ [method]: action })
      button(selector).click()
      await settle()
      expect(document.querySelector(status)?.textContent).toContain('Launch rejected')
      expect(document.querySelector(status)?.getAttribute('role')).toBe('status')
      expect(button(selector).disabled).toBe(false)
      expect(button(selector).textContent).toContain('Retry')
      button(selector).click()
      await settle()
      expect(document.querySelector(status)?.textContent).toBe('')
      expect(action).toHaveBeenCalledTimes(2)
    })
    it(`explains an unavailable ${method} bridge visibly`, async () => {
      mount()
      button(selector).click()
      await settle()
      expect(document.querySelector(status)?.textContent).toMatch(/unavailable/i)
    })
  }

  it('does not display an old guide failure after switching guides', async () => {
    let reject!: (error: Error) => void
    mount({ openAgentGuide: () => new Promise((_, fail) => { reject = fail }) })
    button('[data-agent-guide]').click()
    button('[data-guide="opencode"]').click()
    reject(new Error('Old guide failed'))
    await settle()
    expect(document.querySelector('#guide-open-status')?.textContent).toBe('')
    expect(button('[data-agent-guide]').textContent).toContain('OpenCode')
    expect(button('[data-agent-guide]').disabled).toBe(false)
  })
})


describe('Home setup journey', () => {
  it('updates Cyberpunk Turbo from local status without losing the current setup focus', () => {
    const page = mount()
    const guide = button('[data-guide="opencode"]')
    guide.focus()
    const themedState = { ...state, theme: 'cyberpunk-turbo' }
    page.update(themedState)
    expect(document.documentElement.dataset.theme).toBe('cyberpunk-turbo')
    expect(document.activeElement).toBe(guide)
    page.update(state)
    expect(document.documentElement.dataset.theme).toBe('')
    expect(document.activeElement).toBe(guide)
  })

  it('remembers a recognized guide across Home reloads without storing setup text', () => {
    mount()
    button('[data-guide="opencode"]').click()
    expect(window.localStorage.getItem('hronaut.home.guide')).toBe('opencode')
    expect(window.localStorage.getItem('hronaut.home.guide')).not.toContain('mcp add')
    mount()
    expect(document.querySelector('#guide-name')?.textContent).toBe('OpenCode')
    expect(button('[data-guide="opencode"]').getAttribute('aria-pressed')).toBe('true')
  })

  it('falls back to Codex for an unknown remembered guide', () => {
    window.localStorage.setItem('hronaut.home.guide', '<script>unknown</script>')
    mount()
    expect(document.querySelector('#guide-name')?.textContent).toBe('Codex')
  })

  it('keeps setup usable when preference reads and writes are blocked', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('Storage blocked') })
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage blocked') })
    expect(() => mount()).not.toThrow()
    button('[data-guide="opencode"]').click()
    expect(document.querySelector('#guide-name')?.textContent).toBe('OpenCode')
  })

  it('filters guides without losing focus or replacing the selected guide and recovers from no results', () => {
    const home = mount()
    const search = document.querySelector<HTMLInputElement>('#agent-search')!
    search.focus()
    search.value = 'qwen'
    search.dispatchEvent(new Event('input'))
    expect(button('[data-guide="qwen-code"]').hidden).toBe(false)
    expect(button('[data-guide="codex"]').hidden).toBe(true)
    expect(document.querySelector('#guide-name')?.textContent).toBe('Codex')
    home.update(state)
    expect(document.activeElement).toBe(search)
    expect(search.value).toBe('qwen')
    search.value = 'no-agent-exists'
    search.dispatchEvent(new Event('input'))
    expect(document.querySelector<HTMLElement>('#agent-empty')?.hidden).toBe(false)
    search.value = ''
    search.dispatchEvent(new Event('input'))
    expect(button('[data-guide="codex"]').hidden).toBe(false)
    expect(document.querySelector<HTMLElement>('#agent-empty')?.hidden).toBe(true)
  })

  it('keeps the selected view and focus when new activity arrives', () => {
    const home = mount()
    button('[data-home-view="connect"]').click()
    const guide = button('[data-guide="opencode"]')
    guide.focus()
    home.update({ ...state, clients: [{ id: 'client', name: 'Example agent', version: '1', lastSeenAt: '2026-09-04T12:00:00.000Z', activeRequests: 0, requestCount: 1 }] })
    expect(document.querySelector<HTMLElement>('#home-connect')?.hidden).toBe(false)
    expect(document.activeElement).toBe(guide)
    expect(document.querySelector('#connection-note')?.textContent).toContain('A client has been seen')
    button('[data-home-view="overview"]').click()
    expect(document.querySelector<HTMLElement>('#home-connect')?.hidden).toBe(true)
    expect(document.querySelector<HTMLElement>('#home-overview')?.hidden).toBe(false)
  })

  it('remembers a view, accepts only known destinations, and supports roving keyboard navigation', () => {
    mount()
    button('[data-home-view="overview"]').click()
    mount()
    expect(document.querySelector<HTMLElement>('#home-overview')?.hidden).toBe(false)
    const overview = button('[data-home-view="overview"]')
    overview.focus()
    overview.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(button('[data-home-view="tools"]')).toBe(document.activeElement)
    expect(button('[data-home-view="tools"]').getAttribute('aria-selected')).toBe('true')
    expect(document.querySelector<HTMLElement>('#home-tools')?.hidden).toBe(false)
    expect(button('[data-home-view="overview"]').tabIndex).toBe(-1)
    button('[data-home-view="tools"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))
    expect(document.querySelector<HTMLElement>('#home-workspaces')?.hidden).toBe(false)
    window.localStorage.setItem('hronaut.home.view.v2', '<invalid>')
    mount()
    expect(button('[data-home-view="workspaces"]').getAttribute('aria-selected')).toBe('true')
  })

  it('keeps troubleshooting recovery visible after activity succeeds', async () => {
    const home = mount({ openSetupHelp: vi.fn().mockRejectedValue(new Error('Help failed')) })
    button('[data-setup-help]').click()
    await settle()
    home.update({ ...state, completedToolCalls: 1 })
    expect(button('[data-setup-help]').hidden).toBe(false)
    expect(document.querySelector('#support-help-status')?.textContent).toBe('Help failed')
    expect(button('[data-setup-help]').textContent).toContain('Retry')
  })

  it('does not report a client connection after copying setup', async () => {
    mount({ copyText: vi.fn().mockResolvedValue(undefined) })
    button('[data-copy-target="guide-code"]').click()
    await settle()
    expect(document.querySelector('#connection-note')?.textContent).toBe('Waiting for your agent')
  })

  it('filters the optional tool reference and preserves its query through dashboard refreshes', () => {
    const home = mount()
    const search = document.querySelector<HTMLInputElement>('#tool-search')!
    search.value = 'navigate'
    search.dispatchEvent(new Event('input'))
    expect(document.querySelector<HTMLElement>('#tool-empty')?.hidden).toBe(false)
    home.update({ ...state, tools: [
      { name: 'browser_navigate', category: 'Navigation', description: 'Open a page' },
      { name: 'browser_click', category: 'Interaction', description: 'Click an element' }
    ] })
    expect(document.querySelectorAll('#tool-grid .tool')).toHaveLength(1)
    expect(document.querySelector('#tool-grid')?.textContent).toContain('browser_navigate')
    expect(search.value).toBe('navigate')
  })

  it('preserves an expanded tool and keyboard focus while activity updates', () => {
    const home = mount()
    const next: McpDashboardState = { ...state, tools: [{ name: 'browser_navigate', category: 'Navigation', description: 'Open a page' }] }
    home.update(next)
    const entry = document.querySelector<HTMLDetailsElement>('#tool-grid details')!
    entry.open = true
    const summary = entry.querySelector('summary')!
    summary.focus()
    home.update({ ...next, totalRequests: 4 })
    expect(document.querySelector('#tool-grid details')).toBe(entry)
    expect(entry.open).toBe(true)
    expect(document.activeElement).toBe(summary)
    home.update({ ...next, tools: [...next.tools, { name: 'browser_click', category: 'Interaction', description: 'Click an element' }] })
    expect(document.querySelector<HTMLDetailsElement>('[data-tool="browser_navigate"]')!.open).toBe(true)
  })
})

describe('Home workspace hub', () => {
  const workspace = {
    id: 'project', name: 'Research <safe>', color: 'purple', createdAt: '2026-09-13', lastUsedAt: '2026-09-13',
    activeTabId: null, tabCount: 0, storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] }
  }
  const inventory = { activeTabId: 'home', allHumanInteractionLocked: false, mcpTabGroups: [workspace], savedTabGroups: [], tabs: [] }

  it('defaults to workspaces, searches labels safely, and keeps focus through polling', async () => {
    mount({ getWorkspaces: vi.fn().mockResolvedValue(inventory) })
    await settle()
    expect(button('[data-home-view="workspaces"]').getAttribute('aria-selected')).toBe('true')
    await vi.advanceTimersByTimeAsync(2000)
    expect(document.querySelector('.home-workspace-card h2')?.textContent).toBe('Research <safe>')
    const search = document.querySelector<HTMLInputElement>('#workspace-search')!
    search.focus()
    search.value = 'research'
    search.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(document.activeElement).toBe(search)
    expect(document.querySelectorAll('.home-workspace-card')).toHaveLength(1)
    search.value = 'missing'
    search.dispatchEvent(new Event('input'))
    expect(document.querySelectorAll('.home-workspace-card')).toHaveLength(0)
    expect(document.querySelector('.workspace-empty')?.textContent).toContain('No matching workspaces')
  })

  it('serializes mutations, reports failure, and allows retry without losing the card', async () => {
    let fail!: (error: Error) => void
    const action = vi.fn().mockImplementationOnce(() => new Promise((_, reject) => { fail = reject })).mockResolvedValue(inventory)
    mount({ getWorkspaces: vi.fn().mockResolvedValue(inventory), workspaceAction: action })
    await vi.advanceTimersByTimeAsync(2000)
    button('[data-workspace-action="archive"]').click()
    button('[data-workspace-action="create"]').click()
    expect(action).toHaveBeenCalledTimes(1)
    expect(button('[data-workspace-action="archive"]').disabled).toBe(true)
    fail(new Error('Archive failed'))
    await settle()
    expect(document.querySelector('#workspace-error')?.textContent).toBe('Archive failed')
    expect(button('[data-workspace-action="archive"]').disabled).toBe(false)
    button('[data-workspace-action="archive"]').click()
    await settle()
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('confirms and clears an open workspace beside Archive even while website input is locked', async () => {
    const locked = { ...inventory, allHumanInteractionLocked: true }
    const cleared = { ...locked, mcpTabGroups: [] }
    const action = vi.fn().mockResolvedValue(cleared)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mount({ getWorkspaces: vi.fn().mockResolvedValue(locked), workspaceAction: action })
    await settle()

    const actions = [...document.querySelectorAll<HTMLButtonElement>('.home-workspace-card footer button')]
    expect(actions.map(item => item.textContent)).toEqual(['Open workspace', 'Manage', 'Archive', 'Clear…'])
    expect(button('[data-workspace-action="clear"]').disabled).toBe(false)
    button('[data-workspace-action="clear"]').click()
    await settle()

    expect(confirm).toHaveBeenCalledWith('Permanently clear “Research <safe>”, close its pages, and delete its website data? This cannot be undone.')
    expect(action).toHaveBeenCalledWith({ view: 'clear', workspaceId: 'project' })
    expect(document.querySelector('#workspace-notice')?.textContent).toBe('“Research <safe>” cleared.')
  })

  it('does not let an older inventory read undo a completed preference change', async () => {
    let finishRead!: (value: unknown) => void
    const getWorkspaces = vi.fn().mockResolvedValueOnce(inventory).mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve }))
    const next = { ...inventory, mcpTabGroups: [{ ...workspace, deletionProtected: true }] }
    mount({ getWorkspaces, workspaceAction: vi.fn().mockResolvedValue(next) })
    await settle()
    await vi.advanceTimersByTimeAsync(2000)
    const input = document.querySelector<HTMLInputElement>('[data-workspace-preference="deletionProtected"]')!
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))
    await settle()
    finishRead(inventory)
    await settle()
    expect(document.querySelector<HTMLInputElement>('[data-workspace-preference="deletionProtected"]')?.checked).toBe(true)
  })
})
