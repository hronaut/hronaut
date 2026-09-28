// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHomePage } from '../src/main/home-page.js'
import { mountHome } from '../src/renderer/src/home/controller.js'
import type { HomeBootstrap, HronautHomeApi } from '../src/shared/home.js'
import type { McpDashboardState } from '../src/main/mcp/server.js'
import { buildMcpReadinessDiagnostic } from '../src/main/mcp/readiness.js'

const state: McpDashboardState = {
  name: 'hronaut', version: '1.11.50', endpoint: 'http://127.0.0.1:47812/mcp',
  startedAt: '2026-09-04T12:00:00.000Z', activeRequests: 0, totalRequests: 0,
  paused: false, status: 'ready', completedToolCalls: 0, clients: [],
  recentActivity: [], toolMetrics: [], tools: [],
  readiness: buildMcpReadinessDiagnostic({
    checkedAt: '2026-09-04T12:00:00.000Z', serverStatus: 'ready',
    startedAt: '2026-09-04T12:00:00.000Z', advertisedToolNames: [], clients: []
  })
}

let mounted: ReturnType<typeof mountHome> | undefined
function mount(bridge: Record<string, unknown> = {}) {
  mounted?.dispose()
  const html = renderHomePage({ endpoint: state.endpoint, initialState: state, locale: 'en-US' })
  document.documentElement.innerHTML = html
  Object.defineProperty(window, 'hronautHome', { configurable: true, value: bridge })
  const data = JSON.parse(document.querySelector('#home-bootstrap')!.textContent!) as HomeBootstrap
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => state })
  mounted = mountHome(data, bridge as unknown as HronautHomeApi, fetch)
  return mounted
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
  mounted?.dispose()
  vi.restoreAllMocks()
  vi.useRealTimers()
  document.documentElement.innerHTML = ''
  if (localStorageDescriptor) Object.defineProperty(window, 'localStorage', localStorageDescriptor)
  else Reflect.deleteProperty(window, 'localStorage')
})

describe('Home action recovery', () => {
  it('preserves selected readiness text when a status refresh has unchanged content', async () => {
    const page = mount()
    await settle()
    const target = document.querySelector('#readiness-report')!
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(target)
    selection.removeAllRanges()
    selection.addRange(range)
    const selectedText = selection.toString()
    expect(selectedText).not.toBe('')
    page.update({ ...state, totalRequests: 1 })
    expect(selection.toString()).toBe(selectedText)
    selection.removeAllRanges()
  })

  it('selects the current copy target and reports its failure for manual copying', async () => {
    mount({ copyText: vi.fn().mockRejectedValue(new Error('Clipboard unavailable')) })
    const target = document.querySelector('#guide-code')!
    button('[data-copy-target="guide-code"]').click()
    await settle()
    expect(document.querySelector('#copy-status')!.textContent).toMatch(/failed/i)
    expect(window.getSelection()!.toString()).toBe(target.textContent)
    window.getSelection()!.removeAllRanges()
  })

  it('does not let an older copy failure replace the selection or status of a newer copy', async () => {
    let rejectFirst!: (error: Error) => void
    let finishSecond!: () => void
    const copyText = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectFirst = reject }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishSecond = resolve }))
    mount({ copyText })
    const selection = window.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('#readiness-report')!)
    selection.removeAllRanges()
    selection.addRange(range)
    const selectedText = selection.toString()
    expect(selectedText).not.toBe('')

    button('[data-copy-target="guide-code"]').click()
    button('[data-copy-target="readiness-report"]').click()
    rejectFirst(new Error('Older copy rejected'))
    await settle()

    expect(button('[data-copy-target="guide-code"]').title).toBe('Older copy rejected')
    expect(document.querySelector('#copy-status')!.textContent).toBe('')
    expect(selection.toString()).toBe(selectedText)
    finishSecond()
    await settle()
    expect(button('[data-copy-target="readiness-report"]').textContent).toMatch(/copied/i)
    expect(document.querySelector('#copy-status')!.textContent).toBe('')
    selection.removeAllRanges()
  })

  it('restores workspace actions after filtering during a pending action', async () => {
    let finish!: (value: HomeBootstrap['workspaces']) => void
    mount({ workspaceAction: () => new Promise(resolve => { finish = resolve }) })
    const create = button('[data-workspace-action="create"]')
    create.click()
    expect(create.disabled).toBe(true)
    const search = document.querySelector<HTMLInputElement>('#workspace-search')!
    search.value = 'new workspace'; search.dispatchEvent(new Event('input'))
    finish({ mcpTabGroups: [], savedTabGroups: [], tabs: [], activeTabId: null, allHumanInteractionLocked: false })
    await settle()
    expect(create.disabled).toBe(false)
  })
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
    const themedState = { ...state, theme: 'cyberpunk-turbo' as const }
    page.update(themedState)
    expect(document.documentElement.dataset.theme).toBe('cyberpunk-turbo')
    expect(document.activeElement).toBe(guide)
    page.update(state)
    expect(document.documentElement.dataset.theme).toBe('light')
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

  it('restores catalog order after clearing search without replacing retained cards', () => {
    const home = mount()
    const tools: McpDashboardState['tools'] = [
      { name: 'browser_navigate', category: 'Navigation', description: 'Open a page' },
      { name: 'browser_click', category: 'Interaction', description: 'Click an element' }
    ]
    home.update({ ...state, tools })
    const retained = document.querySelector<HTMLDetailsElement>('[data-tool="browser_click"]')!
    retained.open = true
    const search = document.querySelector<HTMLInputElement>('#tool-search')!
    search.focus(); search.value = 'click'; search.dispatchEvent(new Event('input'))
    search.value = ''; search.dispatchEvent(new Event('input'))
    expect(Array.from(document.querySelectorAll<HTMLElement>('#tool-grid .tool'), node => node.dataset.tool))
      .toEqual(tools.map(tool => tool.name))
    expect(document.querySelector('[data-tool="browser_click"]')).toBe(retained)
    expect(retained.open).toBe(true)
    expect(document.activeElement).toBe(search)
  })

  it('reorders refreshed tools and updates labels while retaining expanded focus and literal text', () => {
    const home = mount()
    const tools: McpDashboardState['tools'] = [
      { name: 'browser_navigate', category: 'Navigation', description: 'Open a page' },
      { name: 'browser_click<img src=x>', category: 'Interaction', description: '<b>Literal description</b>' }
    ]
    home.update({ ...state, tools })
    const retained = document.querySelectorAll<HTMLDetailsElement>('#tool-grid details')[1]!
    retained.open = true
    const summary = retained.querySelector('summary')!
    summary.focus()
    home.update({ ...state, tools: [{ ...tools[1]!, category: 'Navigation' }, tools[0]!] })
    expect(document.querySelector('#tool-grid details')).toBe(retained)
    expect(retained.open).toBe(true)
    expect(document.activeElement).toBe(summary)
    expect(retained.querySelector('code')!.textContent).toBe(tools[1]!.name)
    expect(retained.querySelector('.category')!.textContent).toBe('Navigation')
    expect(retained.querySelector('p')!.textContent).toBe('<b>Literal description</b>')
    expect(retained.querySelector('img, b')).toBeNull()
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

describe('Home MCP readiness diagnostics', () => {
  it('extracts only known tool names from pasted client output and copies a safe report', async () => {
    const copyText = vi.fn().mockResolvedValue(undefined)
    const tools = [
      { name: 'browser_status', category: 'Session' as const, description: 'Show status' },
      { name: 'browser_snapshot', category: 'Inspection' as const, description: 'Inspect page' }
    ]
    const readiness = buildMcpReadinessDiagnostic({
      checkedAt: '2026-09-04T12:00:00.000Z', serverStatus: 'ready',
      startedAt: '2026-09-04T12:00:00.000Z', advertisedToolNames: tools.map((tool) => tool.name), clients: []
    })
    mount({ copyText }).update({ ...state, tools, readiness })
    const inventory = document.querySelector<HTMLTextAreaElement>('#readiness-tool-inventory')!
    inventory.value = 'Bearer private-token at https://account.example notbrowser_status browser_snapshot <secret>'
    button('#readiness-verify').click()

    const reportText = document.querySelector('#readiness-report')!.textContent!
    const report = JSON.parse(reportText) as McpDashboardState['readiness']
    expect(report.checks.clientVisibility).toMatchObject({
      state: 'partial_tool_inventory',
      evidence: { observedToolCount: 1, missingToolCount: 1, missingTools: ['browser_status'] }
    })
    expect(reportText).not.toContain('private-token')
    expect(reportText).not.toContain('account.example')
    expect(reportText).not.toContain('<secret>')

    button('[data-copy-target="readiness-report"]').click()
    await settle()
    expect(copyText).toHaveBeenCalledWith(reportText)
  })
})

describe('Home workspace hub', () => {
  const workspace = {
    id: 'project', name: 'Research <safe>', color: 'purple', createdAt: '2026-09-13', lastUsedAt: '2026-09-13',
    description: 'Investigate <checkout> regressions and retain the signed-in test account',
    activeTabId: null, tabCount: 0, storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] }
  }
  const inventory = { activeTabId: 'home', allHumanInteractionLocked: false, mcpTabGroups: [workspace], savedTabGroups: [], tabs: [] }

  it.each(['poll', 'create'] as const)('updates onboarding when %s provides the first workspace', async source => {
    const empty = { ...inventory, mcpTabGroups: [] }
    const getWorkspaces = vi.fn().mockResolvedValue(empty)
    const home = mount({ getWorkspaces, workspaceAction: vi.fn().mockResolvedValue(inventory) })
    await settle()
    const onboarding = document.querySelector<HTMLElement>('#home-onboarding')!
    expect(onboarding.hidden).toBe(false)
    if (source === 'poll') {
      getWorkspaces.mockResolvedValue(inventory)
      await vi.advanceTimersByTimeAsync(2000)
    } else {
      button('[data-workspace-action="create"]').click()
      await settle()
    }
    expect(onboarding.hidden).toBe(true)
    home.update(state)
    expect(onboarding.hidden).toBe(true)
  })

  it.each(['altKey', 'ctrlKey', 'metaKey', 'isComposing'])('leaves workspace navigation shortcuts alone with %s', async modifier => {
    mount({ getWorkspaces: vi.fn().mockResolvedValue(inventory) })
    await settle()
    const open = button('#workspaces-open')
    open.focus()
    const modified = new KeyboardEvent('keydown', { key: 'ArrowLeft', [modifier]: true, bubbles: true, cancelable: true })
    open.dispatchEvent(modified)
    expect(modified.defaultPrevented).toBe(false)
    expect(open.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(open)
    const plain = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    open.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
    expect(button('#workspaces-archived').getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(button('#workspaces-archived'))
  })

  it('defaults to workspaces, searches labels safely, and keeps focus through polling', async () => {
    mount({ getWorkspaces: vi.fn().mockResolvedValue(inventory) })
    await settle()
    expect(button('[data-home-view="workspaces"]').getAttribute('aria-selected')).toBe('true')
    await vi.advanceTimersByTimeAsync(2000)
    expect(document.querySelector('.home-workspace-card h2')?.textContent).toBe('Research <safe>')
    expect(document.querySelector('.home-workspace-description')?.textContent).toBe('Investigate <checkout> regressions and retain the signed-in test account')
    expect(document.querySelector('.home-workspace-description')?.innerHTML).toContain('&lt;checkout&gt;')
    const search = document.querySelector<HTMLInputElement>('#workspace-search')!
    search.focus()
    search.value = 'research'
    search.dispatchEvent(new Event('input'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(document.activeElement).toBe(search)
    expect(document.querySelectorAll('.home-workspace-card')).toHaveLength(1)
    search.value = 'signed-in test account'
    search.dispatchEvent(new Event('input'))
    expect(document.querySelectorAll('.home-workspace-card')).toHaveLength(1)
    search.value = 'missing'
    search.dispatchEvent(new Event('input'))
    expect(document.querySelectorAll('.home-workspace-card')).toHaveLength(0)
    expect(document.querySelector('.workspace-empty')?.textContent).toContain('No matching workspaces')
  })

  it.each([false, true])('preserves card content and action contracts for archived=%s', async archived => {
    const id = 'project" data-unexpected="true'
    const name = '<img src=x onerror="alert(1)">'
    const title = '<button>Page title</button>'
    const group = { ...workspace, id, name, hiddenFromSidebar: true, deletionProtected: true,
      agentAccess: false, savedAt: workspace.lastUsedAt,
      tabs: [{ title, url: 'https://example.com/' }] }
    const next = { ...inventory, mcpTabGroups: archived ? [] : [group],
      savedTabGroups: archived ? [group] : [], tabs: [{ id: 'tab', mcpGroupId: id, title, url: 'https://example.com/' }] }
    const action = vi.fn().mockResolvedValue(next)
    mount({ getWorkspaces: vi.fn().mockResolvedValue(next), workspaceAction: action })
    await settle()
    if (archived) button('#workspaces-archived').click()
    const card = document.querySelector<HTMLElement>('.home-workspace-card')!
    expect(card.getAttribute('aria-label')).toBe(name)
    expect(card.querySelector('h2')?.textContent).toBe(name)
    expect(card.querySelector('.home-workspace-preview')?.textContent).toBe(title)
    expect(card.querySelectorAll('img,[data-unexpected]')).toHaveLength(0)
    expect(Array.from(card.querySelectorAll<HTMLButtonElement>('footer button'), control => control.dataset.workspaceAction))
      .toEqual(archived ? ['open', 'transfer', 'delete'] : ['open', 'edit', 'archive', 'clear'])
    expect(button(`[data-workspace-action="${archived ? 'delete' : 'clear'}"]`).disabled).toBe(true)
    for (const input of card.querySelectorAll<HTMLInputElement>('input')) {
      expect(input.checked).toBe(true)
      expect(input.dataset.workspaceId).toBe(id)
    }
    button('[data-workspace-action="open"]').click()
    await settle()
    expect(action).toHaveBeenCalledWith({ view: 'open', workspaceId: id })
  })

  it.each([
    '[data-workspace-action="edit"]',
    '[data-workspace-preference="deletionProtected"]',
    'summary'
  ])('preserves focused %s when polling changes and reorders a workspace card', async selector => {
    const older = { ...workspace, id: 'older', name: 'Older workspace', lastUsedAt: '2026-09-12' }
    const getWorkspaces = vi.fn().mockResolvedValue({ ...inventory, mcpTabGroups: [workspace, older] })
    mount({ getWorkspaces })
    await settle()
    const card = document.querySelectorAll<HTMLElement>('.home-workspace-card')[1]!
    card.querySelector<HTMLDetailsElement>('details')!.open = true
    card.querySelector<HTMLElement>(selector)!.focus()
    expect(document.activeElement).toBe(card.querySelector(selector))
    getWorkspaces.mockResolvedValue({ ...inventory, mcpTabGroups: [workspace, { ...older, lastUsedAt: '2026-09-14', description: 'Refreshed description' }] })
    await vi.advanceTimersByTimeAsync(2000)
    expect(document.querySelector('.home-workspace-card')).toBe(card)
    expect(card.querySelector('details')!.open).toBe(true)
    expect(document.activeElement).toBe(card.querySelector(selector))
    expect(card.textContent).toContain('Refreshed description')
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

  it('keeps Archive enabled for a workspace without tabs while page input is locked', async () => {
    const action = vi.fn().mockResolvedValue(inventory)
    mount({ getWorkspaces: vi.fn().mockResolvedValue({ ...inventory, allHumanInteractionLocked: true }), workspaceAction: action })
    await settle()
    expect(button('[data-workspace-action="archive"]').disabled).toBe(false)
    button('[data-workspace-action="archive"]').click()
    await settle()
    expect(action).toHaveBeenCalledWith({ view: 'archive', workspaceId: 'project' })
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
