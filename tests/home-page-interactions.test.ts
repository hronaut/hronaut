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

  it('keeps setup open and focused when a client appears and allows explicit reopening', () => {
    const home = mount()
    const setup = document.querySelector<HTMLDetailsElement>('#setup')!
    button('[data-guide="opencode"]').focus()
    const focus = document.activeElement
    home.update({ ...state, clients: [{ id: 'client', name: 'Example agent', version: '1', lastSeenAt: '2026-09-04T12:00:00.000Z', activeRequests: 0, requestCount: 1 }] })
    expect(setup.open).toBe(true)
    expect(document.activeElement).toBe(focus)
    expect(document.querySelector('#connection-note')?.textContent).toContain('A client has been seen')
    setup.open = false
    home.update(state)
    expect(setup.open).toBe(false)
    document.querySelector<HTMLAnchorElement>('[data-open-setup]')!.click()
    expect(setup.open).toBe(true)
  })

  it('remembers an explicit setup collapse and still provides the Connect shortcut', () => {
    mount()
    const setup = document.querySelector<HTMLDetailsElement>('#setup')!
    setup.open = false
    setup.dispatchEvent(new Event('toggle'))
    mount()
    expect(document.querySelector<HTMLDetailsElement>('#setup')?.open).toBe(false)
    document.querySelector<HTMLAnchorElement>('[data-open-setup]')!.click()
    expect(document.querySelector<HTMLDetailsElement>('#setup')?.open).toBe(true)
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
})
