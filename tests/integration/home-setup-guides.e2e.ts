import { BROWSER_TOOL_CATALOG } from '../../src/main/mcp/server.js'
import { expect, test } from './fixtures.js'

// Agents installed on this computer, such as Claude Code, are listed first on Home and change the guide it copies,
// so these cases start Hronaut with an empty stand-in home folder.
test.use({ standInHome: true })

test('copies Home setup natively, reports failures in shell chrome, and withholds the bridge from websites', async ({
  appWindow,
  electronApp
}) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some((contents) => contents.getURL().startsWith('hronaut://home'))
  )).toBe(true)
  await electronApp.evaluate(({ clipboard }) => clipboard.clear())
  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    await home.executeJavaScript(`document.querySelector('[data-copy-target="guide-code"]').click()`)
  })

  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain('codex mcp add hronaut')
  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    return home?.executeJavaScript(`document.querySelector('[data-copy-target="guide-code"]').textContent`)
  })).toBe('Copied')

  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    await home.executeJavaScript(`document.querySelector('[data-copy-target="first-run-prompt"]').click()`)
  })
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('Hronaut first run')
  await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
    .toContain('Use only this workspace.')

  await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Clipboard boundary</title>', active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)'))
    .toBe('Clipboard boundary')
  const websiteBridge = await electronApp.evaluate(async ({ webContents }) => {
    const website = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Clipboard boundary')
    if (!website) throw new Error('Website web contents was not found')
    return website.executeJavaScript(`typeof window.hronautHome`)
  })
  expect(websiteBridge).toBe('undefined')

  await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).click()
  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    await home.executeJavaScript(`(() => {
      const button = document.querySelector('[data-copy-target="guide-code"]');
      const target = document.getElementById(button.dataset.copyTarget);
      target.textContent = 'x'.repeat(${8 * 1024 * 1024 + 1});
      button.click();
    })()`)
  })
  const toast = appWindow.getByRole('alert', { name: 'Copy failed' })
  await expect(toast).toBeVisible()
  await expect(toast).toContainText('maximum 8 MB')
})

test('shows typed agent setup, connection activity, and the live tool catalog on Home', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  await expect
    .poll(() =>
      electronApp.evaluate(async ({ webContents }) => {
        const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
        return home?.getTitle()
      })
    )
    .toBe('Hronaut Home')

  await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!.executeJavaScript('Boolean(document.querySelector("#server-state .dot.ready"))').catch(() => false))).toBe(true)
  const homeContent = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(`(() => {
      document.querySelector('[data-home-view="connect"]').click();
      document.querySelector('[data-guide="opencode"]')?.click();
      const result = {
        heading: document.querySelector('h1')?.textContent,
        agents: [...document.querySelectorAll('[data-guide]')].map((node) => node.textContent),
        tools: document.querySelectorAll('.tool').length,
        activeCount: document.getElementById('active-count')?.textContent,
        requestCount: document.getElementById('request-count')?.textContent,
        verifyCommand: document.getElementById('guide-verify-command')?.textContent,
        verifyHidden: document.getElementById('guide-verify')?.hidden,
        geminiConfig: null,
        gooseConfig: null,
        gooseVerifyCommand: null,
        kiloConfig: null,
        kiloVerifyCommand: null,
        junieConfig: null,
        junieVerifyCommand: null,
        devinConfig: null,
        devinVerifyCommand: null,
        zedConfig: null,
        zedVerifyCommand: null,
        windsurfConfig: null,
        windsurfVerifyCommand: null,
        grokCommand: null,
        grokVerifyCommand: null,
        qwenCommand: null,
        qwenVerifyCommand: null,
        zooConfig: null,
        zooVerifyCommand: null
      };
      document.querySelector('[data-guide="gemini-cli"]')?.click();
      result.geminiConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      document.querySelector('[data-guide="goose"]')?.click();
      result.gooseConfig = document.getElementById('guide-code')?.textContent;
      result.gooseVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="kilo"]')?.click();
      result.kiloConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.kiloVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="jetbrains-junie"]')?.click();
      result.junieConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.junieVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="devin-local"]')?.click();
      result.devinConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.devinVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="zed"]')?.click();
      result.zedConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.zedVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="windsurf"]')?.click();
      result.windsurfConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.windsurfVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="grok-build"]')?.click();
      result.grokCommand = document.getElementById('guide-code')?.textContent;
      result.grokVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="qwen-code"]')?.click();
      result.qwenCommand = document.getElementById('guide-code')?.textContent;
      result.qwenVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      document.querySelector('[data-guide="zoo-code"]')?.click();
      result.zooConfig = JSON.parse(document.getElementById('guide-code')?.textContent ?? '{}');
      result.zooVerifyCommand = document.getElementById('guide-verify-command')?.textContent;
      return result;
    })()`)
  }) as {
    heading: string
    agents: string[]
    tools: number
    activeCount: string
    requestCount: string
    verifyCommand: string
    verifyHidden: boolean
    geminiConfig: {
      mcpServers?: {
        hronaut?: {
          httpUrl?: string
          url?: string
          type?: string
          headers?: { Authorization?: string }
        }
      }
    }
    gooseConfig: string
    gooseVerifyCommand: string
    kiloConfig: {
      mcp?: {
        hronaut?: {
          type?: string
          url?: string
          enabled?: boolean
          oauth?: boolean
          headers?: { Authorization?: string }
        }
      }
    }
    kiloVerifyCommand: string
    junieConfig: {
      mcpServers?: {
        hronaut?: {
          url?: string
          headers?: { Authorization?: string }
        }
      }
    }
    junieVerifyCommand: string
    devinConfig: {
      mcpServers?: {
        hronaut?: {
          url?: string
          transport?: string
          headers?: { Authorization?: string }
        }
      }
    }
    devinVerifyCommand: string
    zedConfig: {
      context_servers?: {
        hronaut?: {
          url?: string
          headers?: { Authorization?: string }
        }
      }
    }
    zedVerifyCommand: string
    windsurfConfig: {
      mcpServers?: {
        hronaut?: {
          serverUrl?: string
          headers?: { Authorization?: string }
        }
      }
    }
    windsurfVerifyCommand: string
    grokCommand: string
    grokVerifyCommand: string
    qwenCommand: string
    qwenVerifyCommand: string
    zooConfig: {
      mcpServers?: {
        hronaut?: {
          type?: string
          url?: string
          alwaysAllow?: string[]
          disabled?: boolean
        }
      }
    }
    zooVerifyCommand: string
  }
  expect(homeContent.heading).toBe('Connect your coding agent')
  expect(homeContent.agents).toEqual(['Codex', 'Claude Code', 'Cursor', 'VS Code / Copilot', 'OpenCode', 'Gemini CLI', 'Goose', 'Cline', 'Zoo Code', 'Kiro', 'Kilo Code', 'JetBrains Junie', 'Devin Local', 'Zed', 'Mistral Vibe', 'Warp', 'Windsurf', 'Grok Build', 'Qwen Code', 'Generic MCP client'])
  expect(homeContent.tools).toBe(BROWSER_TOOL_CATALOG.length)
  expect(homeContent.activeCount).toBe('0 active')
  expect(homeContent.requestCount).toBe('Waiting for the first tool call')
  expect(homeContent.verifyCommand).toBe('opencode mcp list')
  expect(homeContent.verifyHidden).toBe(false)
  expect(homeContent.geminiConfig.mcpServers?.hronaut).toEqual({
    httpUrl: `http://127.0.0.1:${mcpPort}/mcp`
  })
  expect(homeContent.gooseConfig).toContain('type: streamable_http')
  expect(homeContent.gooseConfig).toContain(`uri: "http://127.0.0.1:${mcpPort}/mcp"`)
  expect(homeContent.gooseConfig).toContain('headers: {}')
  expect(homeContent.gooseVerifyCommand).toBe('goose info -v')
  expect(homeContent.kiloConfig.mcp?.hronaut).toEqual({
    type: 'remote',
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    enabled: true,
    oauth: false
  })
  expect(homeContent.kiloVerifyCommand).toBe('kilo mcp list')
  expect(homeContent.junieConfig.mcpServers?.hronaut).toEqual({
    url: `http://127.0.0.1:${mcpPort}/mcp`
  })
  expect(homeContent.junieVerifyCommand).toBe('/mcp')
  expect(homeContent.devinConfig.mcpServers?.hronaut).toEqual({
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    transport: 'http'
  })
  expect(homeContent.devinVerifyCommand).toBe('devin mcp list && devin mcp get hronaut')
  expect(homeContent.zedConfig.context_servers?.hronaut).toEqual({
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    headers: { Authorization: 'Hronaut local-no-auth' }
  })
  expect(homeContent.zedVerifyCommand).toBe('Settings → AI → MCP Servers: Server is active')
  expect(homeContent.windsurfConfig.mcpServers?.hronaut).toEqual({
    serverUrl: `http://127.0.0.1:${mcpPort}/mcp`
  })
  expect(homeContent.windsurfVerifyCommand).toBe('Cascade → MCPs: hronaut is connected')
  expect(homeContent.grokCommand).toBe(`grok mcp add --transport http hronaut http://127.0.0.1:${mcpPort}/mcp`)
  expect(homeContent.grokVerifyCommand).toBe('grok mcp doctor hronaut')
  expect(homeContent.qwenCommand).toBe(`qwen mcp add --scope user --transport http hronaut http://127.0.0.1:${mcpPort}/mcp`)
  expect(homeContent.qwenVerifyCommand).toBe('qwen mcp list')
  expect(homeContent.zooConfig.mcpServers?.hronaut).toEqual({
    type: 'streamable-http',
    url: `http://127.0.0.1:${mcpPort}/mcp`,
    alwaysAllow: [],
    disabled: false
  })
  expect(homeContent.zooVerifyCommand).toBe('Zoo Code → MCP Servers: hronaut is connected')

  const initial = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcpToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'hronaut-integration', version: '1.0.0' }
      }
    })
  })
  expect(initial.ok).toBe(true)
  const initialization = await initial.json() as {
    result?: { instructions?: string }
  }
  expect(initialization.result?.instructions).toContain('create a fresh isolated workspace')
  expect(initialization.result?.instructions).toContain('browser_snapshot')
  expect(initialization.result?.instructions).toContain('browser_request_user_attention')
  expect(initialization.result?.instructions).toContain('persist after this MCP client disconnects')

  await expect
    .poll(() =>
      electronApp.evaluate(async ({ webContents }) => {
        const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
        if (!home) return null
        return home.executeJavaScript(`fetch('/api/status').then((response) => response.json())`)
      })
    )
    .toMatchObject({
      name: 'hronaut',
      totalRequests: 1,
      tools: expect.arrayContaining([expect.objectContaining({ name: 'browser_navigate' })]),
      clients: expect.arrayContaining([expect.objectContaining({ name: 'hronaut-integration', version: '1.0.0' })])
    })

  await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) return null
    return home.executeJavaScript(`({
      activeCount: document.getElementById('active-count')?.textContent,
      requestCount: document.getElementById('request-count')?.textContent
    })`)
  })).toEqual({ activeCount: '0 active', requestCount: '1 MCP request handled' })

  await appWindow.getByRole('button', { name: 'Pause agents' }).click()
  await expect(appWindow.getByRole('button', { name: 'Resume agents' })).toBeVisible()
  const pausedResponse = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcpToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'paused-test', version: '1.0.0' } } })
  })
  expect(pausedResponse.status).toBe(503)
  await expect(pausedResponse.json()).resolves.toEqual({
    error: 'Hronaut is paused by the user. Resume agents from the Hronaut window.',
    handoff: { state: 'PAUSED', activeCommands: 0, priorActionOutcome: 'NOT_ESTABLISHED' },
    preflight: {
      status: 'BLOCKED',
      reason: 'USER_PAUSED',
      writeSafety: 'NOT_ESTABLISHED',
      nextAction: 'Ask the operator to inspect the page and resume agents, then obtain a fresh snapshot. Pause does not roll back an action already dispatched.'
    }
  })
  const pausedDashboard = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    return home?.executeJavaScript(`fetch('/api/status').then((response) => response.json())`)
  }) as { paused: boolean; status: string }
  expect(pausedDashboard.paused).toBe(true)
  expect(pausedDashboard.status).toBe('paused')

  await appWindow.getByRole('button', { name: 'Resume agents' }).click()
  await expect(appWindow.getByRole('button', { name: 'Pause agents' })).toBeVisible()
  await expect.poll(() => appWindow.evaluate('window.hronautMcp.getState()')).toMatchObject({ status: 'ready', paused: false })
  const resumed = await fetch(`http://127.0.0.1:${mcpPort}/mcp`, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${mcpToken}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'resumed-test', version: '1.0.0' } } })
  })
  expect(resumed.ok).toBe(true)
})
