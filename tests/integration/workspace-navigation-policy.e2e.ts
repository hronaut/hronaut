import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { BrowserState } from '../../src/shared/types.js'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

test('enforces trusted workspace allowlists for direct and page-driven top-level navigation', async ({
  appWindow,
  electronApp
}) => {
  const blockedServer = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Blocked destination</title><main>Blocked destination</main>')
  })
  const blockedOrigin = await listen(blockedServer)
  const allowedServer = createServer((request, response) => {
    if (request.url === '/redirect') {
      response.writeHead(302, { location: `${blockedOrigin}/redirected?secret=redirect-secret` })
      response.end()
      return
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Allowed fixture</title><main>Allowed fixture</main>
      <a id="blocked-link" href="${blockedOrigin}/linked?secret=link-secret">Blocked link</a>
      <button id="blocked-popup" onclick="window.open('${blockedOrigin}/popup?secret=popup-secret')">Popup</button>`)
  })
  const allowedOrigin = await listen(allowedServer)

  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(760, 600))
    await appWindow.getByRole('button', { name: 'Create workspace' }).click()
    const editor = appWindow.getByRole('dialog', { name: 'Create workspace' })
    await expect(editor.getByText('Site access', { exact: true })).toBeVisible()
    await editor.getByRole('textbox', { name: 'Workspace name' }).fill('Restricted production QA')
    await editor.getByText('Only listed sites', { exact: true }).click()
    const rules = editor.getByRole('textbox', { name: 'Allowed site rules' })
    await expect(rules).toBeVisible()
    await rules.fill(`${allowedOrigin}\nhttp://localhost:*`)
    await expect(editor.getByRole('button', { name: 'Create workspace' })).toBeVisible()
    await editor.getByRole('button', { name: 'Create workspace' }).click()
    await expect(editor).toBeHidden()

    const created = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
    const workspace = created.mcpTabGroups.find((candidate) => candidate.name === 'Restricted production QA')!
    const tabId = created.activeTabId!
    expect(workspace.navigationPolicy).toEqual({
      mode: 'restricted',
      rules: [allowedOrigin, 'http://localhost:*']
    })

    const allowedUrl = `${allowedOrigin}/allowed`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(allowedUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), allowedUrl)).toBe(true)

    const blockedPath = `${blockedOrigin}/private/path?token=direct-secret#fragment`
    const directError = await appWindow.evaluate(`window.hronaut.navigate({
      tabId: ${JSON.stringify(tabId)},
      url: ${JSON.stringify(blockedPath)}
    }).then(() => '', (error) => String(error.message ?? error))`) as string
    expect(directError).toContain(blockedOrigin)
    expect(directError).not.toContain('/private/path')
    expect(directError).not.toContain('direct-secret')

    const pageContentsId = await electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().find((contents) => contents.getURL() === url)?.id
    ), allowedUrl)
    if (!pageContentsId) throw new Error('Allowed workspace page was not found')
    await electronApp.evaluate(async ({ webContents }, input) => {
      await webContents.fromId(input.id)?.executeJavaScript("document.querySelector('#blocked-link').click()")
    }, { id: pageContentsId })
    await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), pageContentsId)).toBe(allowedUrl)

    await electronApp.evaluate(async ({ webContents }, input) => {
      await webContents.fromId(input.id)?.executeJavaScript("document.querySelector('#blocked-popup').click()")
    }, { id: pageContentsId })
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(await electronApp.evaluate(({ webContents }, origin) => (
      webContents.getAllWebContents().some((contents) => contents.getURL().startsWith(origin))
    ), blockedOrigin)).toBe(false)

    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${allowedOrigin}/redirect`)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), pageContentsId)).not.toContain(blockedOrigin)

    const audit = await appWindow.evaluate(`window.hronaut.listWorkspaceNavigationAudit(${JSON.stringify(workspace.id)})`)
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetOrigin: blockedOrigin, reason: 'no-match', source: 'direct' }),
      expect.objectContaining({ targetOrigin: blockedOrigin, reason: 'no-match', source: 'page' }),
      expect.objectContaining({ targetOrigin: blockedOrigin, reason: 'no-match', source: 'popup' }),
      expect.objectContaining({ targetOrigin: blockedOrigin, reason: 'no-match', source: 'redirect' })
    ]))
    expect(JSON.stringify(audit)).not.toContain('secret')
    expect(JSON.stringify(audit)).not.toContain('/private')

    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, {
      mode: 'unrestricted', rules: []
    })`)
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${allowedOrigin}/history-first`)} })`)
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${blockedOrigin}/history-blocked`)} })`)
    const historyLast = `${allowedOrigin}/history-last`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(historyLast)} })`)
    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, {
      mode: 'restricted', rules: [${JSON.stringify(allowedOrigin)}]
    })`)
    await appWindow.evaluate(`window.hronaut.back(${JSON.stringify(tabId)})`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), pageContentsId)).toBe(historyLast)

    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, {
      mode: 'unrestricted', rules: []
    })`)
    const forwardFirst = `${allowedOrigin}/forward-first`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(forwardFirst)} })`)
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${blockedOrigin}/forward-blocked`)} })`)
    await appWindow.evaluate(`window.hronaut.back(${JSON.stringify(tabId)})`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), pageContentsId)).toBe(forwardFirst)
    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, {
      mode: 'restricted', rules: [${JSON.stringify(allowedOrigin)}]
    })`)
    await appWindow.evaluate(`window.hronaut.forward(${JSON.stringify(tabId)})`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), pageContentsId)).toBe(forwardFirst)

    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, {
      mode: 'unrestricted', rules: []
    })`)
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${blockedOrigin}/open-before-policy-change`)} })`)
    await appWindow.evaluate(`window.hronaut.updateWorkspaceNavigationPolicy(${JSON.stringify(workspace.id)}, {
      mode: 'restricted', rules: [${JSON.stringify(allowedOrigin)}]
    })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), pageContentsId)).toBe('about:blank')

    const archived = await appWindow.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(workspace.id)})`) as BrowserState
    expect(archived.savedTabGroups.find((candidate) => candidate.id === workspace.id)?.navigationPolicy).toEqual({
      mode: 'restricted',
      rules: [allowedOrigin]
    })
    const restored = await appWindow.evaluate(`window.hronaut.restoreSavedTabGroup(${JSON.stringify(workspace.id)})`) as BrowserState
    expect(restored.mcpTabGroups.find((candidate) => candidate.id === workspace.id)?.navigationPolicy).toEqual({
      mode: 'restricted',
      rules: [allowedOrigin]
    })
  } finally {
    await Promise.all([closeServer(allowedServer), closeServer(blockedServer)])
  }
})

test('persists restricted policies and sanitized audit entries across restart', async ({ profileDirectory, mcpPort }) => {
  const first = await launchHronaut(profileDirectory, mcpPort)
  let workspaceId = ''
  try {
    const state = await first.window.evaluate(`window.hronaut.createWorkspace({
      name: 'Persistent allowlist',
      storage: 'scratch',
      navigationPolicy: { mode: 'restricted', rules: ['https://allowed.example'] }
    })`) as BrowserState
    workspaceId = state.mcpTabGroups.find((candidate) => candidate.name === 'Persistent allowlist')!.id
    await first.window.evaluate(`window.hronaut.navigate({
      tabId: ${JSON.stringify(state.activeTabId)},
      url: 'https://blocked.example/private?secret=not-persisted'
    }).catch(() => undefined)`)
  } finally {
    await closeHronaut(first.app)
  }

  const second = await launchHronaut(profileDirectory, mcpPort)
  try {
    const state = await second.window.evaluate('window.hronaut.getState()') as BrowserState
    expect(state.mcpTabGroups.find((candidate) => candidate.id === workspaceId)?.navigationPolicy).toEqual({
      mode: 'restricted',
      rules: ['https://allowed.example']
    })
    const audit = await second.window.evaluate(`window.hronaut.listWorkspaceNavigationAudit(${JSON.stringify(workspaceId)})`)
    expect(audit).toEqual([
      expect.objectContaining({ targetOrigin: 'https://blocked.example', reason: 'no-match', source: 'direct' })
    ])
    expect(JSON.stringify(audit)).not.toContain('/private')
    expect(JSON.stringify(audit)).not.toContain('not-persisted')
  } finally {
    await closeHronaut(second.app)
  }
})
