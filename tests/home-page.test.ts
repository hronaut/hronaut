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
    expect(html).toContain('Try Hronaut with one safe task')
    expect(html).toContain('data-copy-target="first-run-prompt"')
    expect(html).toContain('Do not use the Default workspace.')
    const codex = renderedGuides(html).find((guide) => guide.id === 'codex')
    expect(codex?.verifyCommand).toBe('codex mcp list')
    const claudeCode = renderedGuides(html).find((guide) => guide.id === 'claude-code')
    expect(claudeCode?.verifyCommand).toBe('claude mcp get hronaut')
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
    expect(html).toContain('Спробуйте Hronaut на одному безпечному завданні')
    expect(html).toContain('Не використовуй робочий простір Default.')
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
    const gemini = renderedGuides(html).find((guide) => guide.id === 'gemini-cli')
    expect(gemini?.location).toBe('~/.gemini/settings.json')
    expect(gemini?.verifyCommand).toBe('gemini mcp list')
    expect(JSON.parse(gemini?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          httpUrl: dashboard.endpoint,
          headers: { Authorization: `Bearer <paste token from ${tokenPath}>` }
        }
      }
    })
  })

  it('renders PowerShell-safe authenticated CLI guides on Windows', () => {
    const tokenPath = "C:\\Users\\Yevhen O'Brien\\AppData\\Roaming\\Hronaut\\mcp-token"
    const options = {
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US' as const,
      tokenPath,
      platform: 'win32' as const
    }
    const guides = renderedGuides(renderHomePage(options))
    const codex = guides.find((guide) => guide.id === 'codex')
    const claudeCode = guides.find((guide) => guide.id === 'claude-code')

    expect(codex?.code).toContain(
      "$env:HRONAUT_MCP_TOKEN = (Get-Content -Raw 'C:\\Users\\Yevhen O''Brien\\AppData\\Roaming\\Hronaut\\mcp-token').Trim()"
    )
    expect(codex?.code).not.toContain('export ')
    expect(codex?.code).not.toContain('$(cat ')
    expect(claudeCode?.code).toContain('Authorization: Bearer $env:HRONAUT_MCP_TOKEN')
    expect(claudeCode?.code).not.toContain('Authorization: Bearer $HRONAUT_MCP_TOKEN')
  })

  it('renders Gemini CLI without an authentication header when local authentication is disabled', () => {
    const html = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })
    const gemini = renderedGuides(html).find((guide) => guide.id === 'gemini-cli')

    expect(JSON.parse(gemini?.code ?? '{}')).toEqual({
      mcpServers: { hronaut: { httpUrl: dashboard.endpoint } }
    })
  })
})
