import { describe, expect, it } from 'vitest'
import { renderHomePage } from '../src/main/home-page.js'
import type { McpDashboardState } from '../src/main/mcp/server.js'

interface RenderedGuide {
  id: string
  location: string
  code: string
  setupCommand?: string
  verifyCommand?: string
  action?: string
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
    expect(html).toContain('16 clients')
    expect(html).toContain('<span class="mark">H</span> Hronaut')
    expect(html).toContain('Try Hronaut with one safe task')
    expect(html).toContain('data-copy-target="first-run-prompt"')
    expect(html).toContain('Do not use the Default workspace.')
    expect(html).toContain('data-setup-feedback')
    expect(html).toContain('data-setup-help')
    expect(html).toContain('Troubleshoot connection')
    expect(html).toContain('Share your setup result')
    expect(html).toContain('Never include credentials, tokens, private URLs, or page content.')
    expect(html).toContain('data-copy-target="support-recommend-message"')
    expect(html).toContain('Recommend Hronaut')
    expect(html).toContain('https://hronaut.dev/go/desktop-first-run-share')
    expect(html).toContain('No browser, workspace, or agent data is included.')
    const codex = renderedGuides(html).find((guide) => guide.id === 'codex')
    expect(codex?.verifyCommand).toBe('codex mcp list')
    expect(codex?.code).toContain(dashboard.endpoint)
    const claudeCode = renderedGuides(html).find((guide) => guide.id === 'claude-code')
    expect(claudeCode?.verifyCommand).toBe('claude mcp get hronaut')
    const openCode = renderedGuides(html).find((guide) => guide.id === 'opencode')
    expect(openCode).toBeDefined()
    expect(openCode?.location).toBe('~/.config/opencode/opencode.json')
    expect(openCode?.verifyCommand).toBe('opencode mcp list')
    expect(html).toContain('Verify connection')
    expect(html).toContain('Before launching client')
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
    const kilo = renderedGuides(html).find((guide) => guide.id === 'kilo')
    expect(kilo?.location).toBe('~/.config/kilo/kilo.jsonc')
    expect(kilo?.verifyCommand).toBe('kilo mcp list')
    expect(JSON.parse(kilo?.code ?? '{}')).toEqual({
      $schema: 'https://app.kilo.ai/config.json',
      mcp: {
        hronaut: {
          type: 'remote',
          url: dashboard.endpoint,
          enabled: true,
          oauth: false,
          headers: { Authorization: 'Bearer {env:HRONAUT_MCP_TOKEN}' }
        }
      }
    })
    const junie = renderedGuides(html).find((guide) => guide.id === 'jetbrains-junie')
    expect(junie?.location).toBe('~/.junie/mcp/mcp.json')
    expect(junie?.verifyCommand).toBe('/mcp')
    expect(JSON.parse(junie?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          headers: { Authorization: 'Bearer <HRONAUT_MCP_TOKEN>' }
        }
      }
    })
    const devin = renderedGuides(html).find((guide) => guide.id === 'devin-local')
    expect(devin?.location).toBe('~/.config/devin/mcp_config.json')
    expect(devin?.verifyCommand).toBe('devin mcp list && devin mcp get hronaut')
    expect(JSON.parse(devin?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          transport: 'http',
          headers: { Authorization: 'Bearer <HRONAUT_MCP_TOKEN>' }
        }
      }
    })
    const zed = renderedGuides(html).find((guide) => guide.id === 'zed')
    expect(zed?.location).toBe('Zed user settings.json')
    expect(zed?.verifyCommand).toBe('Settings → AI → MCP Servers: Server is active')
    expect(JSON.parse(zed?.code ?? '{}')).toEqual({
      context_servers: {
        hronaut: {
          url: dashboard.endpoint,
          headers: { Authorization: 'Bearer <HRONAUT_MCP_TOKEN>' }
        }
      }
    })
    const cline = renderedGuides(html).find((guide) => guide.id === 'cline')
    expect(cline?.location).toBe('Cline MCP settings')
    expect(cline?.verifyCommand).toBe('cline config mcp --json')
    expect(JSON.parse(cline?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          type: 'streamableHttp',
          url: dashboard.endpoint,
          headers: { Authorization: 'Bearer <HRONAUT_MCP_TOKEN>' },
          disabled: false,
          autoApprove: []
        }
      }
    })
    const kiro = renderedGuides(html).find((guide) => guide.id === 'kiro')
    expect(kiro?.location).toBe('~/.kiro/settings/mcp.json')
    expect(kiro?.verifyCommand).toBe('Kiro MCP panel: hronaut is connected')
    expect(JSON.parse(kiro?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          headers: { Authorization: 'Bearer ${HRONAUT_MCP_TOKEN}' },
          disabled: false,
          autoApprove: []
        }
      }
    })
    const mistralVibe = renderedGuides(html).find((guide) => guide.id === 'mistral-vibe')
    expect(mistralVibe?.location).toBe('~/.vibe/config.toml')
    expect(mistralVibe?.verifyCommand).toBe('/mcp hronaut')
    expect(mistralVibe?.code).toBe(`[[mcp_servers]]
name = "hronaut"
transport = "streamable-http"
url = "${dashboard.endpoint}"
api_key_env = "HRONAUT_MCP_TOKEN"
api_key_header = "Authorization"
api_key_format = "Bearer {token}"`)
    const warp = renderedGuides(html).find((guide) => guide.id === 'warp')
    expect(warp?.location).toBe('~/.warp/.mcp.json')
    expect(warp?.verifyCommand).toBe('Settings → Agents → MCP servers: hronaut is running')
    expect(JSON.parse(warp?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          headers: { Authorization: 'Bearer <HRONAUT_MCP_TOKEN>' }
        }
      }
    })
    const windsurf = renderedGuides(html).find((guide) => guide.id === 'windsurf')
    expect(windsurf?.location).toBe('~/.codeium/windsurf/mcp_config.json')
    expect(windsurf?.verifyCommand).toBe('Cascade → MCPs: hronaut is connected')
    expect(JSON.parse(windsurf?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          serverUrl: dashboard.endpoint,
          headers: { Authorization: 'Bearer ${env:HRONAUT_MCP_TOKEN}' }
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
    expect(html).toContain('Поділитися результатом налаштування')
    expect(html).toContain('browser_click')
    expect(html).toContain(dashboard.endpoint)
  })

  it('offers troubleshooting before success and reveals referral sharing only after a successful call', () => {
    const html = renderHomePage({ endpoint: dashboard.endpoint, initialState: dashboard, locale: 'en-US' })

    expect(html).toContain('id="support-troubleshoot"')
    expect(html).toContain('id="support-feedback"')
    expect(html).toContain('const successful = Math.max(0, completed - failures)')
    expect(html).toContain('supportTroubleshoot.hidden = successful > 0')
    expect(html).toContain('supportRecommend.hidden = successful === 0')
    expect(html).toContain('supportFeedback.textContent = successful > 0')
    expect(html).toContain('window.hronautHome.openSetupHelp()')
    expect(html).toContain("window.hronautHome.openSetupFeedback()")
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
    const kilo = renderedGuides(html).find((guide) => guide.id === 'kilo')
    const kiloConfig = JSON.parse(kilo?.code ?? '{}') as {
      mcp?: { hronaut?: { headers?: { Authorization?: string } } }
    }
    expect(kiloConfig.mcp?.hronaut?.headers?.Authorization).toBe('Bearer {file:/tmp/hronaut-owner-token}')
    expect(kilo?.code).not.toContain('<paste token')
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
    const cline = renderedGuides(html).find((guide) => guide.id === 'cline')
    expect(JSON.parse(cline?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          type: 'streamableHttp',
          url: dashboard.endpoint,
          headers: { Authorization: `Bearer <paste token from ${tokenPath}>` },
          disabled: false,
          autoApprove: []
        }
      }
    })
    const junie = renderedGuides(html).find((guide) => guide.id === 'jetbrains-junie')
    expect(JSON.parse(junie?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          headers: { Authorization: `Bearer <paste token from ${tokenPath}>` }
        }
      }
    })
    const devin = renderedGuides(html).find((guide) => guide.id === 'devin-local')
    expect(JSON.parse(devin?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          transport: 'http',
          headers: { Authorization: `Bearer \${file:${tokenPath}}` }
        }
      }
    })
    expect(devin?.code).not.toContain('<paste token')
    const zed = renderedGuides(html).find((guide) => guide.id === 'zed')
    expect(JSON.parse(zed?.code ?? '{}')).toEqual({
      context_servers: {
        hronaut: {
          url: dashboard.endpoint,
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
    const kiro = guides.find((guide) => guide.id === 'kiro')
    const mistralVibe = guides.find((guide) => guide.id === 'mistral-vibe')
    const windsurf = guides.find((guide) => guide.id === 'windsurf')

    expect(codex?.code).toContain(
      "$env:HRONAUT_MCP_TOKEN = (Get-Content -Raw 'C:\\Users\\Yevhen O''Brien\\AppData\\Roaming\\Hronaut\\mcp-token').Trim()"
    )
    expect(codex?.code).not.toContain('export ')
    expect(codex?.code).not.toContain('$(cat ')
    expect(claudeCode?.code).toContain('Authorization: Bearer $env:HRONAUT_MCP_TOKEN')
    expect(claudeCode?.code).not.toContain('Authorization: Bearer $HRONAUT_MCP_TOKEN')
    expect(kiro?.setupCommand).toBe(
      "$env:HRONAUT_MCP_TOKEN = (Get-Content -Raw 'C:\\Users\\Yevhen O''Brien\\AppData\\Roaming\\Hronaut\\mcp-token').Trim()"
    )
    expect(mistralVibe?.setupCommand).toBe(kiro?.setupCommand)
    expect(JSON.parse(windsurf?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          serverUrl: dashboard.endpoint,
          headers: { Authorization: `Bearer \${file:${tokenPath}}` }
        }
      }
    })
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

  it('offers one-click VS Code setup only without MCP authentication', () => {
    const unauthenticatedHtml = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })
    const authenticatedHtml = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: false
    })

    expect(renderedGuides(unauthenticatedHtml).find((guide) => guide.id === 'vscode')?.action)
      .toBe('open-vscode-install')
    expect(unauthenticatedHtml).toContain('<button type="button" data-vscode-install>')
    expect(unauthenticatedHtml).toContain('Open in VS Code')
    expect(renderedGuides(authenticatedHtml).find((guide) => guide.id === 'vscode')?.action).toBeUndefined()
    expect(authenticatedHtml).not.toContain('<button type="button" data-vscode-install>')
    expect(authenticatedHtml).not.toContain('vscode:mcp/install')
  })

  it('localizes the safe VS Code setup action', () => {
    const html = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'uk-UA',
      authenticationDisabled: true
    })

    expect(html).toContain('Відкрити у VS Code')
  })

  it('renders JetBrains Junie user setup without an authentication header when local authentication is disabled', () => {
    const html = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })
    const junie = renderedGuides(html).find((guide) => guide.id === 'jetbrains-junie')

    expect(JSON.parse(junie?.code ?? '{}')).toEqual({
      mcpServers: { hronaut: { url: dashboard.endpoint } }
    })
  })

  it('renders Devin Local user setup without an authentication header when local authentication is disabled', () => {
    const html = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })
    const devin = renderedGuides(html).find((guide) => guide.id === 'devin-local')

    expect(JSON.parse(devin?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          transport: 'http'
        }
      }
    })
  })

  it('renders the Zed OAuth-bypass marker only while Hronaut authentication is disabled', () => {
    const html = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })
    const zed = renderedGuides(html).find((guide) => guide.id === 'zed')

    expect(JSON.parse(zed?.code ?? '{}')).toEqual({
      context_servers: {
        hronaut: {
          url: dashboard.endpoint,
          headers: { Authorization: 'Hronaut local-no-auth' }
        }
      }
    })
  })

  it('renders Cline Streamable HTTP setup without an authentication header when local authentication is disabled', () => {
    const html = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })
    const cline = renderedGuides(html).find((guide) => guide.id === 'cline')

    expect(JSON.parse(cline?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          type: 'streamableHttp',
          url: dashboard.endpoint,
          disabled: false,
          autoApprove: []
        }
      }
    })
  })

  it('renders Kilo Code remote MCP setup without an authentication header when local authentication is disabled', () => {
    const html = renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })
    const kilo = renderedGuides(html).find((guide) => guide.id === 'kilo')

    expect(JSON.parse(kilo?.code ?? '{}')).toEqual({
      $schema: 'https://app.kilo.ai/config.json',
      mcp: {
        hronaut: {
          type: 'remote',
          url: dashboard.endpoint,
          enabled: true,
          oauth: false
        }
      }
    })
  })

  it('renders Kiro, Mistral Vibe, and Warp without authentication material when local authentication is disabled', () => {
    const guides = renderedGuides(renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    }))
    const kiro = guides.find((guide) => guide.id === 'kiro')
    const mistralVibe = guides.find((guide) => guide.id === 'mistral-vibe')
    const warp = guides.find((guide) => guide.id === 'warp')

    expect(JSON.parse(kiro?.code ?? '{}')).toEqual({
      mcpServers: {
        hronaut: {
          url: dashboard.endpoint,
          disabled: false,
          autoApprove: []
        }
      }
    })
    expect(mistralVibe?.code).toBe(`[[mcp_servers]]
name = "hronaut"
transport = "streamable-http"
url = "${dashboard.endpoint}"`)
    expect(JSON.parse(warp?.code ?? '{}')).toEqual({
      mcpServers: { hronaut: { url: dashboard.endpoint } }
    })
    expect(kiro?.code).not.toContain('HRONAUT_MCP_TOKEN')
    expect(mistralVibe?.code).not.toContain('HRONAUT_MCP_TOKEN')
    expect(warp?.code).not.toContain('HRONAUT_MCP_TOKEN')
  })

  it('keeps owner token paths out of environment-backed Kiro and Mistral Vibe configuration', () => {
    const tokenPath = '/tmp/private Hronaut token'
    const guides = renderedGuides(renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      tokenPath
    }))
    const kiro = guides.find((guide) => guide.id === 'kiro')
    const mistralVibe = guides.find((guide) => guide.id === 'mistral-vibe')

    expect(kiro?.code).toContain('Bearer ${HRONAUT_MCP_TOKEN}')
    expect(mistralVibe?.code).toContain('api_key_env = "HRONAUT_MCP_TOKEN"')
    expect(kiro?.code).not.toContain(tokenPath)
    expect(mistralVibe?.code).not.toContain(tokenPath)
    expect(kiro?.setupCommand).toBe(`export HRONAUT_MCP_TOKEN="$(cat '${tokenPath}')"`)
    expect(mistralVibe?.setupCommand).toBe(kiro?.setupCommand)
  })

  it('keeps the owner token inside Windsurf file interpolation', () => {
    const tokenPath = '/tmp/private Hronaut token'
    const windsurf = renderedGuides(renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      tokenPath
    })).find((guide) => guide.id === 'windsurf')
    const config = JSON.parse(windsurf?.code ?? '{}') as {
      mcpServers?: { hronaut?: { headers?: { Authorization?: string } } }
    }

    expect(config.mcpServers?.hronaut?.headers?.Authorization)
      .toBe(`Bearer \${file:${tokenPath}}`)
    expect(windsurf?.code).not.toContain('<paste token')
  })

  it('renders Windsurf without authentication material when local authentication is disabled', () => {
    const windsurf = renderedGuides(renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      authenticationDisabled: true
    })).find((guide) => guide.id === 'windsurf')

    expect(JSON.parse(windsurf?.code ?? '{}')).toEqual({
      mcpServers: { hronaut: { serverUrl: dashboard.endpoint } }
    })
  })

  it('keeps Windows token paths literal inside Kilo trusted file references', () => {
    const tokenPath = "C:\\Users\\Yevhen O'Brien\\AppData\\Roaming\\Hronaut\\mcp-token"
    const guides = renderedGuides(renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      tokenPath,
      platform: 'win32'
    }))
    const kilo = guides.find((guide) => guide.id === 'kilo')
    const config = JSON.parse(kilo?.code ?? '{}') as {
      mcp?: { hronaut?: { headers?: { Authorization?: string } } }
    }

    expect(config.mcp?.hronaut?.headers?.Authorization).toBe(`Bearer {file:${tokenPath}}`)
  })

  it('uses the Windows Devin Local path and keeps owner-token file interpolation local', () => {
    const tokenPath = "C:\\Users\\Yevhen O'Brien\\AppData\\Roaming\\Hronaut\\mcp-token"
    const guides = renderedGuides(renderHomePage({
      endpoint: dashboard.endpoint,
      initialState: dashboard,
      locale: 'en-US',
      tokenPath,
      platform: 'win32'
    }))
    const devin = guides.find((guide) => guide.id === 'devin-local')
    const config = JSON.parse(devin?.code ?? '{}') as {
      mcpServers?: { hronaut?: { headers?: { Authorization?: string } } }
    }

    expect(devin?.location).toBe('%APPDATA%\\devin\\mcp_config.json')
    expect(config.mcpServers?.hronaut?.headers?.Authorization).toBe(`Bearer \${file:${tokenPath}}`)
    expect(devin?.code).not.toContain('<paste token')
  })
})
