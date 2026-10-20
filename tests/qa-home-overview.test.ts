// @vitest-environment jsdom
// Redesign QA for #873: Overview in plain words. Recent actions say what the agent did (the tool name and timing stay
// in the tooltip) and each setup check says Ready, Needs attention or Not yet, with its typed state only in the
// copied diagnostic.
import { describe, expect, it } from 'vitest'
import type { McpReadinessNextAction, McpReadinessState } from '../src/main/mcp/readiness.js'
import type { HomeDashboard } from '../src/shared/home.js'
import type { McpActivityResult } from '../src/shared/types.js'
import { baseDashboard, byId, flush, installHomeHooks, isoMinutesAgo, mountTestHome, query, words } from './qa-home-harness.js'

installHomeHooks()

type Activity = HomeDashboard['recentActivity'][number]
let activityId = 0
const activity = (toolName: string, overrides: Partial<Activity> = {}): Activity => ({
  activityId: `activity-${++activityId}`, tabId: 'tab', toolName, startedAt: isoMinutesAgo(3), completedAt: isoMinutesAgo(2),
  durationMs: 120, outcome: 'finished', ...overrides
})
const result = (outcome: McpActivityResult['outcome']): McpActivityResult =>
  ({ outcome, reasonCode: 'COMPLETED', dispatch: 'dispatched', effects: 'possible', evidenceSource: 'hronaut-observed' })

const items = () => [...byId('activity-list').querySelectorAll<HTMLElement>('.activity-item')].map(item => ({
  step: words(item.querySelector('.activity-step')),
  outcome: words(item.querySelector('.outcome')),
  tone: item.querySelector('.outcome')!.className.replace(/\s+/gu, ' ').trim(),
  title: item.title
}))

describe('Overview recent actions in plain words (#873)', () => {
  it('says what was done, keeps the tool name and timing in the tooltip, and says what was tried when it did not succeed', async () => {
    mountTestHome({
      dashboard: {
        ...baseDashboard, completedToolCalls: 7,
        recentActivity: [
          activity('browser_click', { durationMs: 1234 }),
          activity('browser_snapshot', { outcome: 'failed' }),
          activity('browser_navigate', { result: result('blocked') }),
          activity('browser_type', { outcome: 'failed', result: result('timed-out') }),
          activity('browser_console'),
          activity('browser_made_up_tool'),
          activity('browser_wait', { result: result('outcome-unknown') })
        ]
      }
    })
    await flush()
    expect(items()).toEqual([
      { step: 'Clicked on the page', outcome: 'Done', tone: 'outcome', title: 'browser_click · 1,234 ms' },
      { step: 'Reading the page', outcome: 'Failed', tone: 'outcome failed', title: 'browser_snapshot · 120 ms' },
      { step: 'Opening a page', outcome: 'Blocked', tone: 'outcome attention', title: 'browser_navigate · 120 ms' },
      { step: 'Typing', outcome: 'Timed out', tone: 'outcome attention', title: 'browser_type · 120 ms' },
      { step: 'Inspected the page', outcome: 'Done', tone: 'outcome', title: 'browser_console · 120 ms' },
      { step: 'Finished a step', outcome: 'Done', tone: 'outcome', title: 'browser_made_up_tool · 120 ms' },
      { step: 'Waiting for the page', outcome: 'Outcome unknown', tone: 'outcome attention', title: 'browser_wait · 120 ms' }
    ])
    // No snake_case tool name or millisecond count reaches the visible text.
    expect(words(byId('activity-list'))).not.toMatch(/browser_|\bms\b/u)
    expect(words(query('#activity-list .activity-meta'))).toBe('2m ago')
  })

  it('lists at most the eight newest actions', async () => {
    mountTestHome({ dashboard: { ...baseDashboard, completedToolCalls: 10, recentActivity: Array.from({ length: 10 }, (_, index) => activity(index ? 'browser_scroll' : 'browser_hover')) } })
    await flush()
    expect(items()).toHaveLength(8)
    expect(items()[0]!.step).toBe('Pointed at the page')
  })

  it('says there are no tab actions yet', async () => {
    mountTestHome()
    await flush()
    expect(byId('activity-list').querySelector('.activity-item')).toBeNull()
    expect(words(query('#activity-list .empty strong'))).toBe('No tab actions yet')
    expect(words(query('#activity-list .empty span'))).toBe('Tool calls will appear here after an agent starts working.')
  })

  it('shows one heading per panel', async () => {
    mountTestHome()
    await flush()
    byId<HTMLButtonElement>('home-tab-overview').click()
    expect(words(byId('home-view-title'))).toBe('Agent activity')
    expect(words(byId('activity-title'))).toBe('Recent activity')
  })
})

describe('Overview setup checks in words (#873)', () => {
  const states: Array<[McpReadinessState, 'ok' | 'failed' | 'pending', string]> = [
    ['app_ready', 'ok', 'Ready'], ['endpoint_ready', 'ok', 'Ready'], ['client_initialized', 'ok', 'Ready'],
    ['tools_advertised', 'ok', 'Ready'], ['client_tools_verified', 'ok', 'Ready'], ['probe_verified', 'ok', 'Ready'],
    ['blocked', 'failed', 'Needs attention'], ['probe_failed', 'failed', 'Needs attention'],
    ['client_visibility_unknown', 'pending', 'Not yet'], ['partial_tool_inventory', 'pending', 'Not yet'], ['unknown', 'pending', 'Not yet']
  ]
  const checkRows = () => [...byId('readiness-checks').querySelectorAll<HTMLElement>('.readiness-check')]

  it.each(states)('says %s as "%s"', async (state, tone, word) => {
    const checks = Object.fromEntries(Object.keys(baseDashboard.readiness.checks).map(name => [name, { state, nextAction: 'none' as const }]))
    mountTestHome({ dashboard: { ...baseDashboard, readiness: { ...baseDashboard.readiness, checks: checks as HomeDashboard['readiness']['checks'] } } })
    await flush()
    const rows = checkRows()
    expect(rows).toHaveLength(7)
    for (const row of rows) {
      expect(query('.readiness-dot', row).className).toBe(`readiness-dot ${tone}`)
      expect(query('.readiness-dot', row).getAttribute('aria-hidden')).toBe('true')
      expect(query('.readiness-tone', row).className).toBe(`readiness-tone ${tone}`)
      expect(words(query('.readiness-tone', row))).toBe(word)
      // The typed state stays in the copied diagnostic only.
      expect(row.textContent).not.toContain(state)
    }
    expect(byId('readiness-report').textContent).toContain(`"state": "${state}"`)
  })

  it('names each check and says what to do next', async () => {
    const next: Record<string, McpReadinessNextAction> = {
      app: 'start_honaut', endpoint: 'none', initialization: 'connect_client', advertisedTools: 'none',
      configuration: 'verify_client_configuration', clientVisibility: 'list_tools_in_active_client', probe: 'retry_read_only_probe'
    }
    const checks = Object.fromEntries(Object.entries(next).map(([name, nextAction]) => [name, { state: 'unknown', nextAction }]))
    mountTestHome({ dashboard: { ...baseDashboard, readiness: { ...baseDashboard.readiness, checks: checks as HomeDashboard['readiness']['checks'] } } })
    await flush()
    expect(checkRows().map(row => [words(row.querySelector('strong')), words(row.querySelector('.readiness-next'))])).toEqual([
      ['Application', 'Start or repair the local Hronaut listener.'],
      ['Local endpoint', 'No action needed for this check.'],
      ['Client initialization', 'Reconnect the active MCP client and wait for initialization.'],
      ['Advertised tools', 'No action needed for this check.'],
      ['Client configuration', 'Confirm this endpoint and authentication in the active client configuration.'],
      ['Tools visible in active client', 'List tools in the active client and compare them here.'],
      ['Read-only probe', 'Inspect the active client error, then retry one read-only probe.']
    ])
  })

  it('shows a pasted tool list as text, never as markup', async () => {
    mountTestHome({ dashboard: { ...baseDashboard, tools: [{ name: 'browser_click', category: 'Interaction', description: 'Click' }] } })
    await flush()
    const inventory = byId<HTMLTextAreaElement>('readiness-tool-inventory')
    inventory.value = '<img src=x onerror=alert(1)> browser_click'
    byId<HTMLButtonElement>('readiness-verify').click()
    expect(byId('readiness-checks').querySelector('img')).toBeNull()
    const visibility = checkRows()[5]!
    expect(words(visibility.querySelector('.readiness-tone'))).toBe('Ready')
  })

  it('folds the checks and connections under one disclosure that the connection check\'s link opens', async () => {
    mountTestHome()
    await flush()
    const details = query<HTMLDetailsElement>('.overview-details')
    expect(details.open).toBe(false)
    expect(words(query('summary', details))).toBe('Setup checks and connections')
    expect(details.contains(byId('readiness-checks'))).toBe(true)
    expect(details.contains(byId('connections'))).toBe(true)
    byId<HTMLButtonElement>('home-tab-connect').click()
    query<HTMLButtonElement>('[data-open-view="overview"][data-open-details]').click()
    expect(details.open).toBe(true)
    expect(byId('home-overview').hidden).toBe(false)
    expect(document.activeElement).toBe(byId('home-tab-overview'))
  })

  it('lists each connection as text, with its requests counted in the interface language', async () => {
    // A client's request count read "1 requests", and "Запросов: 1" in Russian.
    const client = (name: string, requestCount: number) => ({ name, version: '1.0.0', lastSeenAt: isoMinutesAgo(0), requestCount, activeRequests: 0 })
    mountTestHome({ dashboard: { ...baseDashboard, clients: [client('<img src=x onerror=alert(1)>', 1), client('Codex', 3)] } })
    await flush()
    const rows = [...byId('connections').querySelectorAll('.connection')]
    expect(rows.map(row => words(row.querySelector('.client-meta')).split(' · ').at(-1))).toEqual(['1 request', '3 requests'])
    expect(words(rows[0]!.querySelector('.client-name'))).toBe('<img src=x onerror=alert(1)>')
    expect(byId('connections').querySelector('img')).toBeNull()
    mountTestHome({ locale: 'ru-RU', dashboard: { ...baseDashboard, clients: [client('Codex', 1), client('Cursor', 3), client('Zed', 5)] } })
    await flush()
    expect([...byId('connections').querySelectorAll('.client-meta')].map(meta => words(meta).split(' · ').at(-1))).toEqual(['1 запрос', '3 запроса', '5 запросов'])
  })
})
