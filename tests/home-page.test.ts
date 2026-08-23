import { describe, expect, it } from 'vitest'
import { renderHomePage } from '../src/main/home-page.js'
import type { McpDashboardState } from '../src/main/mcp/server.js'

const dashboard: McpDashboardState = {
  name: 'hronaut',
  version: '1.6.9',
  endpoint: 'http://127.0.0.1:47812/mcp',
  startedAt: '2026-08-21T12:00:00.000Z',
  activeRequests: 0,
  totalRequests: 0,
  paused: false,
  status: 'ready',
  completedToolCalls: 0,
  clients: [],
  recentActivity: [],
  toolMetrics: [],
  tools: [{ name: 'browser_click', category: 'Interaction', description: 'Click an element.' }]
}

describe('Hronaut Home localization', () => {
  it('renders English metadata and interface copy', () => {
    const html = renderHomePage({ endpoint: dashboard.endpoint, initialState: dashboard, locale: 'en-US' })
    expect(html).toContain('<html lang="en-US">')
    expect(html).toContain('<title>Hronaut Home</title>')
    expect(html).toContain('Connect your coding agent')
  })

  it('renders Ukrainian UI while preserving technical MCP content', () => {
    const html = renderHomePage({ endpoint: dashboard.endpoint, initialState: dashboard, locale: 'uk-UA' })
    expect(html).toContain('<html lang="uk-UA">')
    expect(html).toContain('<title>Домівка Hronaut</title>')
    expect(html).toContain('Під’єднайте агента програмування')
    expect(html).toContain('browser_click')
    expect(html).toContain(dashboard.endpoint)
  })

  it('localizes the authentication warning without exposing a token value', () => {
    const tokenPath = '/tmp/hronaut-owner-token'
    const html = renderHomePage({ endpoint: dashboard.endpoint, initialState: dashboard, locale: 'uk-UA', tokenPath })
    expect(html).toContain('Автентифікація обов’язкова')
    expect(html).toContain(tokenPath)
    expect(html).not.toContain('secret-token-value')
  })
})
