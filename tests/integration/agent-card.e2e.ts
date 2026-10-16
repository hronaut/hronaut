import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { expect, test } from './fixtures.js'

function succeeded(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return text
}

function parsed(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(succeeded(result))
}

type CardView = {
  visible: boolean
  topmost: boolean
  focused: boolean
  bounds: Electron.Rectangle
  label: string | null
  text: string
  actions: string[]
  answers: string[]
  focusedControl: string | null
  follow: string | null
}

/** The native view that draws the agent card, while main has it in the window. */
async function cardView(electronApp: ElectronApplication): Promise<CardView | null> {
  return electronApp.evaluate(async ({ BrowserWindow, webContents }) => {
    const children = BrowserWindow.getAllWindows()[0]!.contentView.children
    const view = children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('agent-card.html')
    )) as Electron.WebContentsView | undefined
    if (!view) return null
    const content = await view.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.agent-card')
      const active = document.activeElement
      return {
        label: card?.getAttribute('aria-label') ?? null,
        text: card?.textContent ?? '',
        actions: [...document.querySelectorAll('.agent-card-actions button:not(:disabled)')].map((button) => button.dataset.action),
        answers: [...document.querySelectorAll('.agent-card-answers button:not(:disabled)')].map((button) => button.dataset.action),
        focusedControl: active?.dataset.action ?? (active?.classList.contains('agent-card-close') ? 'close' : active === card ? 'card' : null),
        follow: document.querySelector('.agent-card-switch')?.getAttribute('aria-checked') ?? null
      }
    })()`) as Pick<CardView, 'label' | 'text' | 'actions' | 'answers' | 'focusedControl' | 'follow'>
    return {
      visible: view.getVisible(),
      topmost: children.at(-1) === view,
      focused: webContents.getFocusedWebContents() === view.webContents,
      bounds: view.getBounds(),
      ...content
    }
  })
}

async function clickInCard(electronApp: ElectronApplication, selector: string): Promise<void> {
  await electronApp.evaluate(async ({ BrowserWindow }, selector) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('agent-card.html')
    )) as Electron.WebContentsView
    await view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`)
  }, selector)
}

async function pressInCard(electronApp: ElectronApplication, keyCode: string): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, keyCode) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('agent-card.html')
    )) as Electron.WebContentsView
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  }, keyCode)
}

/** Ctrl/Cmd+. pressed while the page with this URL has focus; resolves with whether the page saw it. */
async function pressShortcutInPage(electronApp: ElectronApplication, url: string): Promise<void> {
  await electronApp.evaluate(({ webContents }, url) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!page) throw new Error('The fixture page was not found')
    page.focus()
    const modifiers = process.platform === 'darwin' ? ['meta'] as const : ['control'] as const
    page.sendInputEvent({ type: 'keyDown', keyCode: '.', modifiers: [...modifiers] })
    page.sendInputEvent({ type: 'keyUp', keyCode: '.', modifiers: [...modifiers] })
  }, url)
}

test('opens an agent card under its avatar to pause, take over and follow, and returns focus', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const connect = async (name: string) => {
    const client = new Client({ name, version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } })
    await client.connect(transport)
    return { client, transport }
  }
  const claude = await connect('Claude Code')
  const windsurf = await connect('Windsurf')
  try {
    const workspace = await connectMcpWorkspace(claude.client, 'Checkout', false)
    const firstUrl = 'data:text/html,<title>Card one</title><body style="margin:0;background:%231d6f42"><main>One</main>'
    const first = parsed(await claude.client.callTool({ name: 'browser_new_tab', arguments: { url: firstUrl, active: true } }) as CallToolResult)
    const firstTabId = (first.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(firstTabId)})`)

    const group = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true })
    const avatar = group.getByRole('button', { name: /^Claude Code, / })
    await expect(avatar).toHaveAttribute('aria-haspopup', 'dialog')
    await expect(avatar).toHaveAttribute('aria-expanded', 'false')

    // A click opens the card under the avatar, above the page, with keyboard focus inside it.
    await avatar.click()
    await expect.poll(async () => (await cardView(electronApp))?.visible ?? false).toBe(true)
    const opened = (await cardView(electronApp))!
    // The card itself has focus, so Enter or Space changes nothing until a control is picked.
    expect(opened).toMatchObject({ topmost: true, focused: true, label: 'Claude Code, agent details', focusedControl: 'card', follow: 'false' })
    expect(opened.text).toContain('Connected over MCP · Checkout')
    expect(opened.text).toContain('Recent steps')
    expect(opened.text).toContain('Opened a new tab')
    // The tab it used is the one in view: no "Show its tab", but Pause and Take over.
    expect(opened.actions).toEqual(['pause', 'take-over'])
    await expect(avatar).toHaveAttribute('aria-expanded', 'true')
    // The view starts at the avatar's lower edge: no part of it, transparent or not, covers the avatar.
    const box = (await avatar.boundingBox())!
    expect(opened.bounds.y).toBeGreaterThanOrEqual(Math.floor(box.y + box.height))
    expect(opened.bounds.width).toBeLessThanOrEqual(340 + 24)

    // Esc closes it and gives focus back to the avatar.
    await pressInCard(electronApp, 'Escape')
    await expect.poll(() => cardView(electronApp)).toBeNull()
    await expect(avatar).toBeFocused()
    await expect(avatar).toHaveAttribute('aria-expanded', 'false')

    // Pause on this tab, from the card; the card stays open and the button turns into Resume.
    await appWindow.keyboard.press(process.platform === 'darwin' ? 'Meta+.' : 'Control+.')
    await expect.poll(async () => (await cardView(electronApp))?.focused ?? false).toBe(true)
    await clickInCard(electronApp, '[data-action="pause"]')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(firstTabId)})?.agentPaused === true)`)).toBe(true)
    await expect.poll(async () => (await cardView(electronApp))?.actions).toEqual(['resume', 'take-over'])
    await clickInCard(electronApp, '[data-action="resume"]')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(firstTabId)})?.agentPaused === true)`)).toBe(false)

    // The Follow switch changes the same setting as the rail's eye.
    await clickInCard(electronApp, '.agent-card-switch')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.followAgentActivity)')).toBe(true)
    await expect.poll(async () => (await cardView(electronApp))?.follow).toBe('true')
    await clickInCard(electronApp, '.agent-card-switch')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.followAgentActivity)')).toBe(false)

    // Focus moving out of the card, such as to the shell, closes it.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
    await expect.poll(() => cardView(electronApp)).toBeNull()

    // Take over: a tab the agent used out of view is paused and shown.
    const secondUrl = 'data:text/html,<title>Card two</title><main>Two</main>'
    const second = parsed(await claude.client.callTool({ name: 'browser_new_tab', arguments: { url: secondUrl, active: false } }) as CallToolResult)
    const secondTabId = (second.tabs as Array<{ id: string }>).find(tab => tab.id !== firstTabId)!.id
    // Ctrl/Cmd+. pressed in the page opens the card while the workspace in view has agents.
    await pressShortcutInPage(electronApp, firstUrl)
    await expect.poll(async () => (await cardView(electronApp))?.actions).toEqual(['show-tab', 'pause', 'take-over'])
    await clickInCard(electronApp, '[data-action="take-over"]')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(secondTabId)
    expect(await appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(secondTabId)})?.agentPaused === true)`)).toBe(true)
    await expect.poll(() => cardView(electronApp)).toBeNull()
    await appWindow.evaluate(`window.hronaut.setTabAgentPaused(${JSON.stringify(secondTabId)}, false)`)

    // An agent that asks for you and then disconnects still needs you: the click that opens its card
    // leaves the request open, so the card shows why and how to answer it.
    await connectMcpWorkspace(windsurf.client, '', false, workspace)
    const request = parsed(await windsurf.client.callTool({ name: 'browser_request_user_attention', arguments: { tabId: firstTabId, reason: 'Check the total.' } }) as CallToolResult)
    await windsurf.transport.terminateSession()
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(secondTabId)})`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(secondTabId)
    const asking = group.getByRole('button', { name: 'Windsurf, needs you', exact: true })
    await asking.click()
    await expect.poll(async () => (await cardView(electronApp))?.answers).toEqual(['hand-back', 'dismiss'])
    expect((await cardView(electronApp))!.text).toContain('Why it needs youCheck the total.')
    await expect(asking).toBeVisible()

    // "Done, hand back" resolves the request for an agent waiting on it. The agent has left, so
    // its card stays, marked as disconnected, and "Show its tab" still shows the tab it asked about.
    await clickInCard(electronApp, '[data-action="hand-back"]')
    const status = async () => parsed(await claude.client.callTool({ name: 'browser_user_attention', arguments: { workspaceId: workspace.workspaceId, requestId: request.id, action: 'status' } }) as CallToolResult).state
    await expect.poll(status).toBe('resolved')
    await expect.poll(async () => (await cardView(electronApp))?.text ?? '').toContain('No longer connected to this workspace')
    const departed = group.getByRole('button', { name: 'Windsurf, disconnected', exact: true })
    await expect(departed).toHaveAttribute('data-state', 'gone')
    await clickInCard(electronApp, '[data-action="show-tab"]')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.activeTabId)')).toBe(firstTabId)
    await expect.poll(() => cardView(electronApp)).toBeNull()
    await expect(group.getByRole('button', { name: /^Windsurf/ })).toHaveCount(0)
  } finally {
    await Promise.allSettled([claude.client.close(), windsurf.client.close()])
  }
})

test('keeps needs you after a click until the agent that asked acts again', async ({ appWindow, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    const workspace = await connectMcpWorkspace(client, 'Sign in', false)
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Sign in</title>', active: true } }) as CallToolResult)
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    const request = parsed(await client.callTool({ name: 'browser_request_user_attention', arguments: { tabId, reason: 'Sign in, then I carry on.' } }) as CallToolResult)
    const group = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true })
    const asking = group.getByRole('button', { name: 'Claude Code, needs you', exact: true })
    await expect(asking).toBeVisible()
    const navigate = async (title: string) => succeeded(await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `data:text/html,<title>${title}</title>` } }) as CallToolResult)

    // Before you respond, even an action of the agent leaves its request open.
    await navigate('Still asking')
    await expect(asking).toBeVisible()
    // A click quiets the request: agents no longer see it, and reading the page afterwards changes nothing.
    await appWindow.locator('.address-form input').click()
    await expect.poll(async () => parsed(await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult).userAttention).toBeNull()
    succeeded(await client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult)
    await expect(asking).toBeVisible()
    // Acting again on the page means the agent moved on: needs you ends, while a waiting call still sees it pending.
    await navigate('Carried on')
    await expect(group.getByRole('button', { name: /^Claude Code, (working|idle)$/ })).toBeVisible()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
    expect(parsed(await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId: workspace.workspaceId, requestId: request.id, action: 'status' } }) as CallToolResult).state).toBe('acknowledged')

    // A seen request whose avatar goes away, here because agent access was turned off, has no card left to answer it, so it ends.
    succeeded(await client.callTool({ name: 'browser_request_user_attention', arguments: { reason: 'Check the receipt.' } }) as CallToolResult)
    await expect(asking).toBeVisible()
    await appWindow.locator('.address-form input').click()
    await expect.poll(async () => parsed(await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult).userAttention).toBeNull()
    await expect(asking).toBeVisible()
    await appWindow.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(workspace.workspaceId)}, { agentAccess: false })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
  } finally {
    await client.close()
  }
})

test('answers a decision from its agent\'s card: Review the decision shows it, and needs you ends with it', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    const workspace = await connectMcpWorkspace(client, 'Release decision', false)
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url: 'data:text/html,<title>Release</title>', active: true } }) as CallToolResult)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify((opened.tabs as Array<{ id: string }>)[0]!.id)})`)
    const decision = parsed(await client.callTool({ name: 'browser_human_waiting', arguments: {
      workspaceId: workspace.workspaceId, action: 'request', runId: randomUUID(), decision: 'resolve-unknown', owner: 'Release owner'
    } }) as CallToolResult)
    expect(decision.state).toBe('WAITING_FOR_HUMAN')
    const group = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true })
    const asking = group.getByRole('button', { name: 'Claude Code, needs you', exact: true })
    await expect(asking).toBeVisible()

    // A click tells the agent you saw it; the decision still needs you.
    await appWindow.locator('.address-form input').click()
    await expect.poll(async () => parsed(await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult).userAttention).toBeNull()
    await expect(asking).toBeVisible()

    // A decision is answered as a decision: the card offers Review the decision, which opens the workspace at its decisions.
    await asking.click()
    await expect.poll(async () => (await cardView(electronApp))?.answers).toEqual(['review-decision'])
    await clickInCard(electronApp, '[data-action="review-decision"]')
    await expect.poll(() => cardView(electronApp)).toBeNull()
    const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
    await expect(editor.locator('.workspace-activity-disclosure')).toHaveAttribute('open', '')
    await expect(editor.locator('.workspace-activity-disclosure > summary')).toBeFocused()
    const panel = editor.getByRole('region', { name: 'Human decisions', exact: true })
    await expect(panel.getByText('Release owner', { exact: true })).toBeVisible()
    // Acknowledging keeps the decision open, and with it needs you.
    await panel.getByRole('button', { name: 'Acknowledge', exact: true }).click()
    await expect(panel.getByText('Acknowledged; review pending', { exact: true })).toBeVisible()
    expect(await appWindow.evaluate('window.hronaut.getUserAttention().then(request => request?.humanWaitingDecisionId)')).toBe(decision.id)
    // A card answer cannot end a decision's request.
    const request = await appWindow.evaluate('window.hronaut.getUserAttention()') as { id: string }
    expect(await appWindow.evaluate(`window.hronaut.answerUserAttention(${JSON.stringify(request.id)}, 'resolved')`)).toBe(false)
    // Cancelling the decision ends it.
    await panel.getByRole('button', { name: 'Cancel decision', exact: true }).click()
    await expect(panel.getByText('Cancelled', { exact: true })).toBeVisible()
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
  } finally {
    await client.close()
  }
})

test('leaves an agent\'s own Ctrl+. to its page', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    await connectMcpWorkspace(client, 'Editor', false)
    const url = 'data:text/html,<title>Editor</title><script>addEventListener("keydown", (event) => { if (event.key === "." && event.ctrlKey) document.title = "Quick fix" })</script>'
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url, active: true } }) as CallToolResult)
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await expect(appWindow.getByRole('button', { name: /^Claude Code, / })).toBeVisible()
    succeeded(await client.callTool({ name: 'browser_press', arguments: { key: 'Control+.', tabId } }) as CallToolResult)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Quick fix')
    expect(await cardView(electronApp)).toBeNull()
  } finally {
    await client.close()
  }
})

test('leaves Ctrl/Cmd+. to the page when its workspace has no agents', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,<title>No agents</title><script>addEventListener("keydown", (event) => { if (event.key === "." && (event.ctrlKey || event.metaKey)) document.title = "Page kept the key" })</script>'
  await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('No agents')
  await pressShortcutInPage(electronApp, url)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Page kept the key')
  expect(await cardView(electronApp)).toBeNull()
})
