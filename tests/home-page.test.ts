import { describe, expect, it } from 'vitest'
import { renderHomePage } from '../src/main/home-page.js'
import type { McpDashboardState } from '../src/main/mcp/server.js'

interface RenderedGuide {
  id: string
  location: string
  code: string
  verifyCommand?: string
}

function renderedGuides(html: string): RenderedGuide[] {
  const source = html.match(/const guides = (.+);\n {4}const messages =/)?.[1]
  if (!source) throw new Error('Hronaut Home did not serialize its MCP client guides')
  return JSON.parse(source) as RenderedGuide[]
}

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
    expect(html).toContain('<span class="mark">H</span> Hronaut')
    const openCode = renderedGuides(html).find((guide) => guide.id === 'opencode')
    expect(openCode).toBeDefined()
    expect(openCode?.location).toBe('~/.config/opencode/opencode.json')
    expect(openCode?.verifyCommand).toBe('opencode mcp list')
    expect(html).toContain('Verify connection')
    expect(JSON.parse(openCode?.code ?? '{}')).toEqual({
      $schema: 'https://opencode.ai/config.json',
      mcp: {
        hronaut: {
          type: 'remote',
          url: dashboard.endpoint,
          enabled: true,
          oauth: false,
          headers: { Authorization: 'Bearer <HRONAUT_MCP_TOKEN>' }
        }
      }
    })
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
    expect(html).toContain('Bearer \\u003cpaste token from /tmp/hronaut-owner-token>')
    const openCode = renderedGuides(html).find((guide) => guide.id === 'opencode')
    const openCodeConfig = JSON.parse(openCode?.code ?? '{}') as {
      mcp?: { hronaut?: { headers?: { Authorization?: string } } }
    }
    expect(openCodeConfig.mcp?.hronaut?.headers?.Authorization).toBe('Bearer {file:/tmp/hronaut-owner-token}')
    expect(openCode?.code).not.toContain('<paste token')
  })
})
