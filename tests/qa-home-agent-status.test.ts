// @vitest-environment jsdom
// Redesign QA for #870: Home's hero says one thing about agents, in the toolbar's words, and keeps the server's own
// state, request counts and any startup error behind Details.
import { describe, expect, it } from 'vitest'
import type { HomeDashboard } from '../src/shared/home.js'
import { agent, baseDashboard, byId, flush, installHomeHooks, mountTestHome, query, words } from './qa-home-harness.js'

installHomeHooks()

const statusText = (): string => words(byId('server-state'))
const statusDot = (): string => query('#server-state .dot').className

describe('Home agent status kinds (#870)', () => {
  it.each<{ name: string; dashboard: Partial<HomeDashboard>; text: string; tone: string }>([
    { name: 'ready with no agents', dashboard: { agents: [] }, text: 'Ready for agents', tone: 'ready' },
    { name: 'ready without an agent list', dashboard: {}, text: 'Ready for agents', tone: 'ready' },
    { name: 'one idle agent, by name', dashboard: { agents: [agent('a', 'Claude Code', 'idle')] }, text: 'Claude Code connected', tone: 'ready' },
    { name: 'one agent seen twice, counted once', dashboard: { agents: [agent('a', 'Claude Code', 'idle'), agent('a', 'Claude Code', 'idle')] }, text: 'Claude Code connected', tone: 'ready' },
    { name: 'a blank name', dashboard: { agents: [agent('a', '   ', 'idle')] }, text: '1 agent connected', tone: 'ready' },
    { name: 'three idle agents', dashboard: { agents: [agent('a', 'Claude Code', 'idle'), agent('b', 'Codex', 'idle'), agent('c', 'Cursor', 'idle')] }, text: '3 agents connected', tone: 'ready' },
    { name: 'one working agent among idle ones', dashboard: { agents: [agent('a', 'Codex', 'working'), agent('b', 'Cursor', 'idle')] }, text: 'Codex is working', tone: 'ready' },
    { name: 'two working agents', dashboard: { agents: [agent('a', 'Codex', 'working'), agent('b', 'Cursor', 'working')] }, text: '2 agents working', tone: 'ready' },
    { name: 'an agent that needs you', dashboard: { agents: [agent('a', 'Codex', 'working'), agent('b', 'Cursor', 'needs-you')] }, text: 'Needs you', tone: 'needs-you' },
    { name: 'paused, even with an agent that needs you', dashboard: { status: 'paused', paused: true, agents: [agent('a', 'Codex', 'needs-you')] }, text: 'Agents paused', tone: 'paused' },
    { name: 'starting', dashboard: { status: 'starting', startedAt: null, agents: [agent('a', 'Codex', 'working')] }, text: 'Getting ready for agents', tone: 'starting' },
    { name: 'error', dashboard: { status: 'error', error: 'listen EADDRINUSE', agents: [agent('a', 'Codex', 'idle')] }, text: 'Agents can’t connect', tone: 'error' }
  ])('says "$text" for $name', async ({ dashboard, text, tone }) => {
    const next = { ...baseDashboard, ...dashboard }
    mountTestHome({ dashboard: next })
    await flush()
    expect(statusText()).toBe(text)
    expect(statusDot()).toBe(`dot ${tone}`)
    // The server's own words stay under Details, never in the status line.
    expect(statusText()).not.toMatch(/MCP|server/u)
  })

  it('follows each read of the local status in place', async () => {
    const home = mountTestHome()
    await flush()
    const line = byId('server-state')
    expect(statusText()).toBe('Ready for agents')
    home.show({ ...baseDashboard, agents: [agent('a', 'Claude Code', 'working')] })
    expect(byId('server-state')).toBe(line)
    expect(statusText()).toBe('Claude Code is working')
    home.show({ ...baseDashboard, agents: [agent('a', 'Claude Code', 'needs-you')] })
    expect(statusText()).toBe('Needs you')
    expect(statusDot()).toBe('dot needs-you')
    home.show({ ...baseDashboard, agents: [] })
    expect(statusText()).toBe('Ready for agents')
    expect(statusDot()).toBe('dot ready')
  })

  it('shows a client name containing placeholders and replacement patterns as written', async () => {
    mountTestHome({ dashboard: { ...baseDashboard, agents: [agent('a', "$' {count} $&", 'working')] } })
    await flush()
    expect(statusText()).toBe("$' {count} $& is working")
  })
})

describe('Home status Details facts (#870)', () => {
  const facts = () => ({
    detail: words(byId('server-detail')),
    active: words(byId('active-count')),
    requests: words(byId('request-count'))
  })

  it.each<{ name: string; dashboard: Partial<HomeDashboard>; detail: string; active: string; requests: string }>([
    { name: 'ready and busy', dashboard: { activeRequests: 2, totalRequests: 5 }, detail: 'MCP server online', active: '2 active', requests: '5 MCP requests handled' },
    { name: 'ready after one request', dashboard: { activeRequests: 0, totalRequests: 1 }, detail: 'MCP server online', active: '0 active', requests: '1 MCP request handled' },
    { name: 'ready before any request', dashboard: {}, detail: 'MCP server online', active: '0 active', requests: 'Waiting for the first tool call' },
    { name: 'paused', dashboard: { status: 'paused', paused: true, totalRequests: 3 }, detail: 'Agents paused', active: 'Paused', requests: '3 MCP requests handled' },
    { name: 'starting', dashboard: { status: 'starting', startedAt: null }, detail: 'MCP server starting', active: 'Starting', requests: 'Waiting for the first tool call' },
    { name: 'an error with its message', dashboard: { status: 'error', error: 'listen EACCES 127.0.0.1:80' }, detail: 'MCP server error: listen EACCES 127.0.0.1:80', active: 'Unavailable', requests: 'Waiting for the first tool call' },
    { name: 'an error without a message', dashboard: { status: 'error' }, detail: 'MCP server error: Unknown startup error', active: 'Unavailable', requests: 'Waiting for the first tool call' }
  ])('lists the server facts for $name under Details', async ({ dashboard, detail, active, requests }) => {
    mountTestHome({ dashboard: { ...baseDashboard, ...dashboard } })
    await flush()
    expect(facts()).toEqual({ detail, active, requests })
    const details = query<HTMLDetailsElement>('.hero-status details.status-details')
    expect(words(query('summary', details))).toBe('Details')
    for (const id of ['server-detail', 'active-count', 'request-count']) expect(details.contains(byId(id))).toBe(true)
    expect(details.contains(byId('server-state'))).toBe(false)
  })

  it('keeps the endpoint and its Copy URL button under Details beside the status', async () => {
    const copyText = async () => {}
    mountTestHome({ api: { copyText } })
    await flush()
    const details = query<HTMLDetailsElement>('.status-details')
    expect(details.open).toBe(false)
    expect(details.contains(byId('endpoint'))).toBe(true)
    expect(words(byId('endpoint'))).toBe(baseDashboard.endpoint)
    expect(words(query('[data-copy-target="endpoint"]', details))).toBe('Copy URL')
  })

  it('closes Details on Escape, a click elsewhere or focus moving past it, as a menu does, but not on a click inside it', async () => {
    mountTestHome({ api: { copyText: async () => {} } })
    await flush()
    const details = query<HTMLDetailsElement>('.status-details')
    const summary = query<HTMLElement>('summary', details)
    details.open = true
    query<HTMLButtonElement>('[data-copy-target="endpoint"]', details).click()
    expect(details.open).toBe(true)
    byId('home-view-title').click()
    expect(details.open).toBe(false)
    details.open = true
    byId('endpoint').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(summary)
    // Escape elsewhere, with Details closed, is left alone.
    const other = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    summary.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    // Opened with the mouse and its text clicked, focus is on the page, and Escape still closes it there.
    details.open = true
    summary.blur()
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(details.open).toBe(false)
    expect(document.activeElement).toBe(document.body)
    // Tabbing past it closes it, so it never covers the control that takes focus.
    details.open = true
    summary.focus()
    expect(details.open).toBe(true)
    query<HTMLButtonElement>('#home-tab-connect').focus()
    expect(details.open).toBe(false)
  })

  it('says the local status is unavailable, under Details too, when Home cannot read it', async () => {
    const home = mountTestHome({ dashboard: { ...baseDashboard, totalRequests: 4 } })
    await flush()
    expect(statusText()).toBe('Ready for agents')
    home.load.mockRejectedValue(new Error('offline'))
    await home.page.refresh()
    expect(statusText()).toBe('Unavailable')
    expect(statusDot()).toBe('dot error')
    expect(facts()).toEqual({ detail: 'Reconnecting to local status', active: 'Unavailable', requests: 'Reconnecting to local status' })
  })

  it('counts requests and actions in the form each number takes', async () => {
    // Home chose between one and many as English does: "Obsłużono 2 żądań MCP", "Hronaut успішно виконав 3 дій із
    // вкладками."
    mountTestHome({ locale: 'pl-PL', dashboard: { ...baseDashboard, activeRequests: 2, totalRequests: 2 } })
    await flush()
    expect(facts().requests).toBe('Obsłużono 2 żądania MCP')
    mountTestHome({ locale: 'uk-UA', dashboard: { ...baseDashboard, activeRequests: 21, totalRequests: 21, completedToolCalls: 3 } })
    await flush()
    expect(facts()).toMatchObject({ active: '21 активний', requests: 'Оброблено 21 MCP-запит' })
    expect(words(byId('activity-count'))).toBe('3 дії')
    expect(words(byId('support-heading'))).toBe('Hronaut успішно виконав 3 дії з вкладками.')
  })
})
