import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication, Page } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function succeeded(result: CallToolResult): string {
  const content = result.content.find(item => item.type === 'text')
  const text = content?.type === 'text' ? content.text : ''
  expect(result.isError, text).not.toBe(true)
  return text
}

function parsed(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(succeeded(result))
}

/**
 * The shell's colors one pixel outside the lit page's top and left edges, where the toolbar and the rail hold
 * the gutter, with the needs-you color they should show. The light's swell is finished for the capture.
 */
async function edgeLightPixels(appWindow: Page): Promise<{ top: number[]; left: number[]; needsYou: number[] }> {
  const light = appWindow.getByTestId('page-card-light')
  const box = (await light.boundingBox())!
  const pixel = async (x: number, y: number): Promise<number[]> => {
    const png = await appWindow.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css', animations: 'disabled' })
    return appWindow.evaluate(async (base64) => {
      const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
      const context = new OffscreenCanvas(1, 1).getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
    }, png.toString('base64'))
  }
  const needsYou = await light.evaluate((element) => {
    const context = new OffscreenCanvas(1, 1).getContext('2d')!
    context.fillStyle = getComputedStyle(element).getPropertyValue('--needs-you').trim()
    context.fillRect(0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
  })
  return { top: await pixel(box.x + box.width / 2, box.y - 1), left: await pixel(box.x - 1, box.y + box.height / 2), needsYou }
}

function nearColor(actual: number[], expected: number[]): boolean {
  return actual.every((channel, index) => Math.abs(channel - expected[index]!) <= 12)
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
  cursor: string | null
  pin: string | null
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
        follow: document.querySelector('[data-action^="follow-"]')?.getAttribute('aria-checked') ?? null,
        cursor: document.querySelector('[data-action^="cursor-"]')?.getAttribute('aria-checked') ?? null,
        pin: document.querySelector('[data-action^="pin-"]')?.getAttribute('aria-checked') ?? null
      }
    })()`) as Pick<CardView, 'label' | 'text' | 'actions' | 'answers' | 'focusedControl' | 'follow' | 'cursor' | 'pin'>
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

/**
 * Waits until main reports the tab an agent last used, and the shell has that report too: main publishes
 * presence on its next turn, so one more round trip arrives after it.
 */
async function agentTabReported(appWindow: Page, name: string, tabId: string): Promise<void> {
  await expect.poll(() => appWindow.evaluate(`window.hronautAgentPresence.get().then(snapshot => Object.values(snapshot.workspaces).flat()
    .find(agent => agent.name === ${JSON.stringify(name)})?.lastTabId)`)).toBe(tabId)
  await appWindow.evaluate('window.hronautAgentPresence.get()')
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
    await clickInCard(electronApp, '[data-action^="follow-"]')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.followAgentActivity)')).toBe(true)
    await expect.poll(async () => (await cardView(electronApp))?.follow).toBe('true')
    // The cursor switch beside it turns agents' cursors on the page off and on.
    expect((await cardView(electronApp))?.cursor).toBe('true')
    await clickInCard(electronApp, '[data-action^="cursor-"]')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.showAgentCursor)')).toBe(false)
    await expect.poll(async () => (await cardView(electronApp))?.cursor).toBe('false')
    await clickInCard(electronApp, '[data-action^="cursor-"]')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.showAgentCursor)')).toBe(true)
    // Its pin switch keeps the agent's live status in a strip below the toolbar (agent-live-strip.e2e.ts).
    expect((await cardView(electronApp))?.pin).toBe('false')
    await clickInCard(electronApp, '[data-action^="pin-"]')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.pinAgentLiveStatus)')).toBe(true)
    await expect(appWindow.getByTestId('agent-live-strip')).toBeVisible()
    await expect.poll(async () => (await cardView(electronApp))?.pin).toBe('true')
    await clickInCard(electronApp, '[data-action^="pin-"]')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.pinAgentLiveStatus)')).toBe(false)
    await expect(appWindow.getByTestId('agent-live-strip')).toHaveCount(0)
    await clickInCard(electronApp, '[data-action^="follow-"]')
    await expect.poll(() => appWindow.evaluate('window.hronautSettings.get().then(settings => settings.followAgentActivity)')).toBe(false)

    // Focus moving out of the card, such as to the shell, closes it.
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.focus())
    await expect.poll(() => cardView(electronApp)).toBeNull()

    // Take over: a tab the agent used out of view is paused and shown.
    const secondUrl = 'data:text/html,<title>Card two</title><main>Two</main>'
    const second = parsed(await claude.client.callTool({ name: 'browser_new_tab', arguments: { url: secondUrl, active: false } }) as CallToolResult)
    const secondTabId = (second.tabs as Array<{ id: string }>).find(tab => tab.id !== firstTabId)!.id
    // The card acts on the tab the avatar shows when it opens, which follows the agent's call once it settles.
    await agentTabReported(appWindow, 'Claude Code', secondTabId)
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
    // The handoff edge light rings the page that needs you, drawn by the shell around the page card: on every side,
    // including the top and left, where the toolbar and the rail paint over the card.
    const lit = appWindow.getByTestId('page-card-light')
    await expect(lit).toHaveCount(1)
    const edges = await edgeLightPixels(appWindow)
    expect(nearColor(edges.top, edges.needsYou), `top edge ${edges.top} vs ${edges.needsYou}`).toBe(true)
    expect(nearColor(edges.left, edges.needsYou), `left edge ${edges.left} vs ${edges.needsYou}`).toBe(true)
    const navigate = async (title: string) => succeeded(await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `data:text/html,<title>${title}</title>` } }) as CallToolResult)

    // Before you respond, even an action of the agent leaves its request open.
    await navigate('Still asking')
    await expect(asking).toBeVisible()
    // A click quiets the request: agents no longer see it, and reading the page afterwards changes nothing.
    await appWindow.locator('.address-form input').click()
    await expect.poll(async () => parsed(await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult).userAttention).toBeNull()
    succeeded(await client.callTool({ name: 'browser_tabs', arguments: {} }) as CallToolResult)
    await expect(asking).toBeVisible()
    await expect(lit).toHaveCount(1)
    // Acting again on the page means the agent moved on: needs you ends, while a waiting call still sees it pending.
    await navigate('Carried on')
    await expect(group.getByRole('button', { name: /^Claude Code, (working|idle)$/ })).toBeVisible()
    await expect(lit).toHaveCount(0)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
    expect(parsed(await client.callTool({ name: 'browser_user_attention', arguments: { workspaceId: workspace.workspaceId, requestId: request.id, action: 'status' } }) as CallToolResult).state).toBe('acknowledged')

    // A seen request whose avatar goes away, here because agent access was turned off, has no card left to answer it, so it ends.
    succeeded(await client.callTool({ name: 'browser_request_user_attention', arguments: { reason: 'Check the receipt.' } }) as CallToolResult)
    await expect(asking).toBeVisible()
    // A request for the whole workspace lights its page in view.
    await expect(lit).toHaveCount(1)
    await appWindow.locator('.address-form input').click()
    await expect.poll(async () => parsed(await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult).userAttention).toBeNull()
    await expect(asking).toBeVisible()
    await appWindow.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(workspace.workspaceId)}, { agentAccess: false })`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()
    await expect(lit).toHaveCount(0)
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

/** Runs a script in the agent card's view and returns its result. */
async function inCard<T>(electronApp: ElectronApplication, script: string): Promise<T> {
  return electronApp.evaluate(async ({ BrowserWindow }, script) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('agent-card.html')
    )) as Electron.WebContentsView | undefined
    if (!view) throw new Error('The agent card view is not open')
    return view.webContents.executeJavaScript(script)
  }, script) as Promise<T>
}

/** Types into the card's answer field as a person would, then optionally sends it with Ctrl or Cmd and Enter. */
async function typeInCard(electronApp: ElectronApplication, text: string, send = false): Promise<void> {
  await inCard(electronApp, 'document.querySelector(\'[data-focus="answer-note"]\').focus()')
  const typing = async (action: 'insert' | 'send') => electronApp.evaluate(async ({ BrowserWindow }, { text, action }) => {
    const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find((child) => (
      'webContents' in child && (child as Electron.WebContentsView).webContents.getURL().endsWith('agent-card.html')
    )) as Electron.WebContentsView
    if (action === 'insert') return view.webContents.insertText(text)
    const modifiers = process.platform === 'darwin' ? ['meta'] as const : ['control'] as const
    view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: [...modifiers] })
    view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: [...modifiers] })
  }, { text, action })
  await typing('insert')
  if (!send) return
  // Inserted text and key events reach the page on separate routes; send only once the text is in the field.
  await expect.poll(() => inCard<string>(electronApp, 'document.querySelector(\'[data-focus="answer-note"]\').value')).toMatch(new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u'))
  await typing('send')
}

type DecisionCard = { reason: string; check: string | null; confirm: boolean; enabled: string[]; field: boolean; plan: string[]; status: string | null }

async function decisionCard(electronApp: ElectronApplication): Promise<DecisionCard | null> {
  try {
    return await inCard<DecisionCard>(electronApp, `(() => ({
      reason: document.querySelector('.agent-card-reason')?.textContent ?? '',
      check: document.querySelector('.agent-card-check-text')?.textContent ?? null,
      confirm: document.querySelector('[data-focus="answer-check"]')?.checked === true,
      enabled: [...document.querySelectorAll('.agent-card-section button:not(:disabled)')].filter((button) => !button.closest('[hidden]'))
        .map((button) => button.dataset.focus ?? button.dataset.action),
      field: !!document.querySelector('.agent-card-field:not([hidden])'),
      plan: [...document.querySelectorAll('.agent-card-plan li')].map((item) => item.textContent),
      status: document.querySelector('.agent-card-status')?.textContent ?? null
    }))()`)
  } catch {
    return null
  }
}

test('answers a page review, an input request and an approval in the agent\'s card', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Checkout</title><h1>Order</h1><button>Place order</button>')
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The checkout fixture did not expose a port')
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    const { workspaceId } = await connectMcpWorkspace(client, 'Card answers', false)
    const opened = parsed(await client.callTool({ name: 'browser_new_tab', arguments: { url: `http://127.0.0.1:${address.port}/checkout`, active: true } }) as CallToolResult)
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    const list = async () => JSON.parse(succeeded(await client.callTool({ name: 'browser_human_waiting', arguments: { workspaceId, action: 'list' } }) as CallToolResult)) as Array<Record<string, unknown>>
    const decisionState = async (id: string) => (await list()).find((record) => record.id === id)
    const request = async (decision: string, extra: Record<string, unknown> = {}) => parsed(await client.callTool({ name: 'browser_human_waiting', arguments: {
      workspaceId, action: 'request', runId: randomUUID(), decision, timeoutMs: 120_000, ...extra
    } }) as CallToolResult)
    const avatar = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: /^Claude Code, / })

    // A page review: the card checks the page, waits for the tick, and hands back.
    const review = await request('review-page')
    await expect(avatar).toHaveAccessibleName('Claude Code, needs you')
    await avatar.click()
    await expect.poll(async () => (await decisionCard(electronApp))?.check ?? null).toContain('Hronaut checked this page')
    let card = (await decisionCard(electronApp))!
    expect(card.reason).toContain('Look at the page, then hand it back or tell the agent what to fix.')
    expect(card.enabled).toEqual(['review-decision', 'answer-toggle'])
    await clickInCard(electronApp, '[data-focus="answer-check"]')
    await expect.poll(async () => (await decisionCard(electronApp))?.enabled).toEqual(['answer-resolve', 'review-decision', 'answer-toggle'])
    await clickInCard(electronApp, '[data-action="answer-resolve"]')
    await expect.poll(async () => (await decisionState(review.id as string))?.state).toBe('RESOLVED')
    expect(typeof (await decisionState(review.id as string))?.answeredAt).toBe('number')
    await expect(avatar).not.toHaveAccessibleName('Claude Code, needs you')
    await expect.poll(() => appWindow.evaluate('window.hronaut.getUserAttention()')).toBeNull()

    // Input: what you type goes to the agent with Ctrl or Cmd and Enter, once the page is confirmed.
    const input = await request('provide-input')
    await expect(avatar).toHaveAccessibleName('Claude Code, needs you')
    if (!await cardView(electronApp)) await avatar.click()
    await expect.poll(async () => (await decisionCard(electronApp))?.reason).toContain('The agent needs your answer to carry on.')
    await expect.poll(async () => (await decisionCard(electronApp))?.check ?? null).toContain('Hronaut checked this page')
    await typeInCard(electronApp, 'Ship to the office')
    await clickInCard(electronApp, '[data-focus="answer-check"]')
    await expect.poll(async () => (await decisionCard(electronApp))?.enabled).toContain('answer-send')
    await typeInCard(electronApp, ', please', true)
    await expect.poll(async () => (await decisionState(input.id as string))?.state).toBe('RESOLVED')
    expect((await decisionState(input.id as string))?.note).toBe('Ship to the office, please')

    // An approval: the card shows what it would do and can reject it, but approving stays in the workspace.
    succeeded(await client.callTool({ name: 'browser_continuity', arguments: { workspaceId, action: 'checkpoint' } }) as CallToolResult)
    const approval = await request('approve-action', { review: {
      toolName: 'browser_click', arguments: { workspaceId, tabId, selector: 'button' }, reversibility: 'irreversible',
      representation: 'bounded-description', description: 'Place the order for 2 items'
    } })
    await expect(avatar).toHaveAccessibleName('Claude Code, needs you')
    if (!await cardView(electronApp)) await avatar.click()
    await expect.poll(async () => (await decisionCard(electronApp))?.plan ?? []).toEqual([expect.stringContaining('Place the order for 2 items')])
    card = (await decisionCard(electronApp))!
    expect(card.plan[0]).toContain('Irreversible')
    expect(card.enabled).toEqual(['review-decision', 'answer-toggle'])
    // A forged completion from the card's view does not approve it.
    const key = `${approval.id as string}_${approval.revision as string}`
    await inCard(electronApp, `(() => { for (let cardId = 1; cardId <= 200; cardId += 1) window.hronautAgentCardView.send({ cardId, kind: 'action', action: 'answer-resolve', key: ${JSON.stringify(key)} }) })()`)
    await clickInCard(electronApp, '[data-focus="answer-toggle"]')
    await expect.poll(async () => (await decisionCard(electronApp))?.field).toBe(true)
    await typeInCard(electronApp, 'Wrong shipping address')
    await clickInCard(electronApp, '[data-focus="answer-send"]')
    await expect.poll(async () => (await decisionState(approval.id as string))?.state).toBe('REJECTED')
    expect((await decisionState(approval.id as string))?.note).toBe('Wrong shipping address')
    await expect(avatar).not.toHaveAccessibleName('Claude Code, needs you')
  } finally {
    await client.close()
    await closeFixtureServer(server)
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

test('names what each step acted on in plain words, without typed text, values or the query', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Checkout</title><label for="promo">Promo code</label><input id="promo" value="value-canary"><button>Review order</button>')
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('The checkout fixture did not expose a port')
  await expect.poll(async () => {
    try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
  }).toBe(true)
  const client = new Client({ name: 'Claude Code', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
  try {
    await connectMcpWorkspace(client, 'Plain words', false)
    const results: string[] = []
    const call = async (name: string, args: Record<string, unknown>) => {
      const text = succeeded(await client.callTool({ name, arguments: args }) as CallToolResult)
      results.push(text)
      return text
    }
    const opened = JSON.parse(await call('browser_new_tab', { url: `http://127.0.0.1:${address.port}/checkout?token=query-canary#fragment-canary`, active: true }))
    const tabId = (opened.tabs as Array<{ id: string }>)[0]!.id
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    const avatar = appWindow.getByRole('group', { name: 'Agents in this workspace', exact: true }).getByRole('button', { name: /^Claude Code, / })
    // The address shows as its host and path only.
    await expect(avatar).toHaveAttribute('data-tooltip', `Claude Code · Opening 127.0.0.1:${address.port}/checkout in a new tab`)
    const snapshot = await call('browser_snapshot', { tabId })
    const promo = /\[(e\d+)\] input/.exec(snapshot)?.[1]
    const review = /\[(e\d+)\] button[^[]*?Review order/.exec(snapshot)?.[1]
    expect(promo, snapshot).toBeTruthy()
    expect(review, snapshot).toBeTruthy()
    await call('browser_type', { tabId, ref: promo, text: 'typed-canary' })
    await call('browser_click', { tabId, ref: review })

    await expect(avatar).toHaveAttribute('data-tooltip', 'Claude Code · Clicking “Review order”')
    await avatar.click()
    await expect.poll(async () => (await cardView(electronApp))?.visible ?? false).toBe(true)
    const card = (await cardView(electronApp))!
    expect(card.text).toContain('Typed in Promo code')
    expect(card.text).toContain('Clicked “Review order”')
    // What the shell gets names the controls and the address only.
    const presence = JSON.stringify(await appWindow.evaluate('window.hronautAgentPresence.get()'))
    for (const text of [card.text, presence]) {
      expect(text).not.toMatch(/canary|token=/)
    }
    // Agents get their usual results: the names are the shell's alone.
    for (const result of results) expect(result).not.toMatch(/Typed in|Clicked “|Opened 127/)
    await pressInCard(electronApp, 'Escape')
    await expect.poll(() => cardView(electronApp)).toBeNull()
  } finally {
    await client.close()
    await closeFixtureServer(server)
  }
})
