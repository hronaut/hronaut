import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, launchHronaut, expect, test } from './fixtures.js'

test('blocks a resumed write after navigation and rejects stale continuity reconciliation', async ({ appWindow, electronApp, mcpPort, mcpToken }, testInfo) => {
  const fixture = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Continuity fixture</title><main>Private fixture</main>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const clients: Client[] = []
  const connect = async () => {
    const client = new Client({ name: 'continuity-qa', version: '1' }); clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    return client
  }
  const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return JSON.parse(text) as T
  }
  const navigate = async (path: string) => electronApp.evaluate(async ({ webContents }, target) => {
    const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(target.origin))
    if (!page) throw new Error('Missing fixture page')
    await page.loadURL(`${target.origin}/${target.path}`)
  }, { origin, path })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    const first = await connect()
    const workspace = decode<{ id: string; resumeKey: string }>(await call(first, 'browser_workspaces', { action: 'create', storage: 'scratch', name: 'Continuity QA' }))
    const args = { workspaceId: workspace.id }
    const state = decode<BrowserState>(await call(first, 'browser_new_tab', { ...args, url: `${origin}/initial` }))
    await expect.poll(() => appWindow.evaluate(async id => {
      const state = await (window as unknown as { hronaut: { getState(): Promise<BrowserState> } }).hronaut.getState()
      return state.tabs.find(tab => tab.id === id)?.loading
    }, state.activeTabId)).toBe(false)
    decode(await call(first, 'browser_continuity', { ...args, action: 'checkpoint' }))
    await appWindow.evaluate('window.hronautMcp.setPaused(true)')
    await appWindow.evaluate('window.hronautMcp.setPaused(false)')
    const unchanged = decode<{ reviewId: string }>(await call(first, 'browser_continuity', { ...args, action: 'status' }))
    expect(unchanged).toMatchObject({ status: 'PASS', suspended: true, nextAction: 'INSPECT_AND_RECONCILE' })
    expect((await call(first, 'browser_evaluate', { ...args, script: 'window.writes = 1' })).isError).toBe(true)
    await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), workspace.id)
    const editor = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
    const continuity = editor.getByRole('region', { name: 'Workspace continuity' })
    await expect(continuity.getByText('Review required before agent actions', { exact: true })).toBeVisible()
    await expect(continuity.getByRole('button', { name: 'Confirm reviewed state' })).toBeEnabled()
    await continuity.scrollIntoViewIfNeeded()
    expect(await continuity.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await appWindow.screenshot({ path: testInfo.outputPath('human-continuity-review.png') })
    const panel = appWindow.locator('.workspace-continuity')
    for (const locale of ['en-US', 'uk-UA']) {
      await appWindow.evaluate(`window.hronautSettings.setLanguagePreference(${JSON.stringify(locale)})`)
      await expect(appWindow.locator('html')).toHaveAttribute('lang', locale)
      for (const theme of ['light', 'dark']) {
        await appWindow.evaluate(`window.hronautSettings.setTheme(${JSON.stringify(theme)})`)
        await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
        for (const width of [1200, 640]) {
          await electronApp.evaluate(({ BrowserWindow }, width) => {
            const window = BrowserWindow.getAllWindows()[0]!
            window.setMinimumSize(600, 600)
            window.setSize(width, 800)
          }, width)
          await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(width)
          await panel.scrollIntoViewIfNeeded()
          const layout = await panel.evaluate(element => {
            const bounds = element.getBoundingClientRect()
            return {
              overflow: element.scrollWidth - element.clientWidth,
              controlsInside: [...element.querySelectorAll('button,input')].every(control => {
                const rect = control.getBoundingClientRect()
                return rect.left >= bounds.left && rect.right <= bounds.right
              })
            }
          })
          expect(layout, `${locale}/${theme}/${width}`).toMatchObject({ controlsInside: true })
          expect(layout.overflow, `${locale}/${theme}/${width}`).toBeLessThanOrEqual(1)
          await appWindow.screenshot({ path: testInfo.outputPath(`continuity-${locale}-${theme}-${width}.png`), animations: 'disabled' })
        }
      }
    }
    await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")
    await appWindow.evaluate("window.hronautSettings.setTheme('light')")
    await expect(appWindow.locator('html')).toHaveAttribute('lang', 'en-US')
    // A visual review may outlive the bounded confirmation handle.
    await continuity.getByRole('button', { name: 'Read current state' }).click()
    await expect(continuity.getByRole('button', { name: 'Confirm reviewed state' })).toBeEnabled()
    await continuity.getByRole('button', { name: 'Confirm reviewed state' }).click()
    await expect(continuity.getByText('Review guard cleared; recheck before a fresh action', { exact: true })).toBeVisible()
    await continuity.getByRole('button', { name: 'Create checkpoint' }).click()
    await expect(continuity.getByRole('button', { name: 'Read current state' })).toBeEnabled()
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(decode(await call(first, 'browser_continuity', { ...args, action: 'status' }))).toMatchObject({ suspended: false })
    await first.close()
    await navigate('changed')
    const second = await connect()
    expect((await call(second, 'browser_continuity', { ...args, action: 'status' })).isError).toBe(true)
    decode(await call(second, 'browser_workspaces', { ...args, action: 'resume', resumeKey: workspace.resumeKey }))
    expect((await call(second, 'browser_evaluate', { ...args, script: 'window.writes = 1; "written"' })).isError).toBe(true)
    expect(await electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))?.executeJavaScript('window.writes ?? 0'), origin)).toBe(0)
    decode(await call(second, 'browser_status', args))
    expect((await call(second, 'browser_snapshot', args)).isError).not.toBe(true)
    const review = decode<{ reviewId: string; reasons: string[] }>(await call(second, 'browser_continuity', { ...args, action: 'status' }))
    expect(review.reasons).toContain('NAVIGATION_CHANGED')
    expect(JSON.stringify(review)).not.toContain(origin)
    expect(JSON.stringify(review)).not.toContain(workspace.resumeKey)
    await navigate('changed-again')
    expect((await call(second, 'browser_continuity', { ...args, action: 'reconcile', reviewId: review.reviewId })).isError).toBe(true)
    const fresh = decode<{ reviewId: string }>(await call(second, 'browser_continuity', { ...args, action: 'status' }))
    decode(await call(second, 'browser_continuity', { ...args, action: 'reconcile', reviewId: fresh.reviewId }))
    const write = await call(second, 'browser_evaluate', { ...args, script: 'window.writes = 1; "written"' })
    expect(write.isError).not.toBe(true)
    expect(await electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))?.executeJavaScript('window.writes'), origin)).toBe(1)
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeFixtureServer(fixture)
  }
})


test('retains the continuity guard across application restart until explicit fresh review', async ({ profileDirectory, mcpPort }) => {
  const fixture = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Restart checkpoint</title><main>Ready</main>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  let instance = await launchHronaut(profileDirectory, mcpPort)
  const token = (await readFile(join(profileDirectory, 'mcp-token'), 'utf8')).trim()
  const clients: Client[] = []
  const connect = async () => {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    const client = new Client({ name: 'continuity-restart', version: '1' }); clients.push(client)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    return client
  }
  const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return JSON.parse(text) as T
  }
  const settled = async () => expect.poll(() => instance.window.evaluate(async () => {
    const state = await (window as unknown as { hronaut: { getState(): Promise<BrowserState> } }).hronaut.getState()
    return state.tabs.every(tab => !tab.loading)
  })).toBe(true)
  try {
    const first = await connect()
    const workspace = decode<{ id: string; resumeKey: string }>(await call(first, 'browser_workspaces', { action: 'create', storage: 'scratch', name: 'Restart guarded' }))
    const args = { workspaceId: workspace.id }
    decode(await call(first, 'browser_new_tab', { ...args, url: origin }))
    await settled()
    decode(await call(first, 'browser_continuity', { ...args, action: 'checkpoint' }))
    await first.close(); await closeHronaut(instance.app)
    instance = await launchHronaut(profileDirectory, mcpPort)
    const second = await connect(); await settled()
    decode(await call(second, 'browser_workspaces', { ...args, action: 'resume', resumeKey: workspace.resumeKey }))
    expect((await call(second, 'browser_evaluate', { ...args, script: 'window.restartedWrite = 1' })).isError).toBe(true)
    const review = decode<{ reviewId: string; status: string; priorOutcome: string }>(await call(second, 'browser_continuity', { ...args, action: 'status' }))
    expect(review).toMatchObject({ status: 'BLOCKED', priorOutcome: 'OUTCOME_UNKNOWN' })
    expect((await call(second, 'browser_continuity', { ...args, action: 'reconcile', reviewId: review.reviewId })).isError).toBe(true)
    const reconciled = decode(await call(second, 'browser_continuity', { ...args, action: 'reconcile', reviewId: review.reviewId, acknowledgeUnknownOutcome: true }))
    expect(reconciled).toMatchObject({ status: 'WARN', priorOutcome: 'OUTCOME_UNKNOWN', priorOutcomeAcknowledged: true, suspended: false, nextAction: 'RECHECK_BEFORE_DISPATCH' })
    expect((await call(second, 'browser_evaluate', { ...args, script: 'window.restartedWrite = 1' })).isError).not.toBe(true)
  } finally {
    await Promise.allSettled(clients.map(client => client.close()))
    await closeHronaut(instance.app)
    await closeFixtureServer(fixture)
  }
})

for (const failPersistence of [false, true]) {
test(`retains a guarded fork when pause occurs during native cookie copy (save failure: ${failPersistence})`, async ({ appWindow, electronApp, mcpPort, mcpToken, profileDirectory }) => {
  const fixture = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><title>Fork source</title>Ready') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'continuity-fork', version: '1' })
  let pendingFork: Promise<CallToolResult> | undefined
  const statePath = join(profileDirectory, 'tabs.json')
  const backupPath = join(profileDirectory, 'continuity-test-tabs-backup.json')
  let stateMoved = false
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const source = decode<{ id: string }>(await call('browser_workspaces', { action: 'create', name: 'Native fork source', storage: 'scratch' }))
    expect((await call('browser_new_tab', { workspaceId: source.id, url: origin })).isError).not.toBe(true)
    await expect.poll(() => electronApp.evaluate(({ webContents }, origin) =>
      webContents.getAllWebContents().some(page => page.getURL().startsWith(origin) && !page.isLoading()), origin)).toBe(true)
    if (failPersistence) {
      await expect.poll(async () => {
        try { return (await readFile(statePath, 'utf8')).includes(source.id) } catch { return false }
      }).toBe(true)
    }
    await electronApp.evaluate(async ({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))
      if (!page) throw new Error('Missing source page')
      const cookies = page.session.cookies
      await cookies.set({ url: origin, name: 'fixture', value: 'synthetic' })
      const original = cookies.get
      const state = globalThis as typeof globalThis & { __continuityForkWaiting?: boolean; __continuityForkRelease?: () => void; __continuityForkRestore?: () => void }
      state.__continuityForkRestore = () => { cookies.get = original }
      cookies.get = async function (filter) {
        cookies.get = original
        state.__continuityForkWaiting = true
        await new Promise<void>(resolve => { state.__continuityForkRelease = resolve })
        return original.call(this, filter)
      }
    }, origin)
    pendingFork = call('browser_workspaces', { action: 'create', name: 'Interrupted fork', storage: 'fork-workspace', sourceWorkspaceId: source.id })
    await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __continuityForkWaiting?: boolean }).__continuityForkWaiting)).toBe(true)
    if (failPersistence) {
      await rename(statePath, backupPath)
      stateMoved = true
      // A directory at the atomic rename destination makes every state save fail.
      await mkdir(statePath)
    }
    await appWindow.evaluate('window.hronautMcp.setPaused(true)')
    await appWindow.evaluate('window.hronautMcp.setPaused(false)')
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { __continuityForkRelease?: () => void }).__continuityForkRelease?.())
    const result = await pendingFork
    expect(result.isError).toBe(true)
    const retained = decode<{ status: string; workspaceId: string; guardPersisted: boolean; retained: boolean }>(result)
    expect(retained).toMatchObject({ status: 'OUTCOME_UNKNOWN', guardPersisted: !failPersistence, retained: true })
    expect((await call('browser_new_tab', { workspaceId: retained.workspaceId, url: origin })).isError).toBe(true)
    const statusResult = await call('browser_continuity', { action: 'status', workspaceId: retained.workspaceId })
    if (failPersistence) {
      expect(statusResult.isError).toBe(true)
      const accessible = await appWindow.evaluate(async id => {
        const state = await (window as unknown as { hronaut: { getState(): Promise<BrowserState> } }).hronaut.getState()
        return state.mcpTabGroups.find(group => group.id === id)?.agentAccess
      }, retained.workspaceId)
      expect(accessible).toBe(false)
    } else {
      expect(decode<{ suspended: boolean }>(statusResult).suspended).toBe(true)
    }
  } finally {
    await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & { __continuityForkWaiting?: boolean; __continuityForkRelease?: () => void; __continuityForkRestore?: () => void }
      state.__continuityForkRelease?.(); state.__continuityForkRestore?.()
      delete state.__continuityForkWaiting; delete state.__continuityForkRelease; delete state.__continuityForkRestore
    })
    await pendingFork?.catch(() => undefined)
    if (stateMoved) {
      await rm(statePath, { recursive: true, force: true })
      await rename(backupPath, statePath)
    }
    await client.close()
    await closeFixtureServer(fixture)
  }
})
}

test('detects opt-in marker changes without navigation and rejects unavailable markers', async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
  const fixture = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><main id="marker">Synthetic initial marker</main>') })
  await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
  const address = fixture.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture address')
  const origin = `http://127.0.0.1:${address.port}`
  const client = new Client({ name: 'continuity-marker', version: '1' })
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const decode = <T>(result: CallToolResult): T => {
    expect(result.isError).not.toBe(true)
    return JSON.parse(result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as T
  }
  const changeMarker = (value: string | null) => electronApp.evaluate(async ({ webContents }, { origin, value }) => {
    const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))
    if (!page) throw new Error('Missing marker fixture page')
    await page.executeJavaScript(`document.querySelector('main').textContent = ${JSON.stringify(value ?? '')}; document.querySelector('main').id = ${JSON.stringify(value === null ? 'missing' : 'marker')}`)
  }, { origin, value })
  try {
    await expect.poll(async () => { try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false } }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    const workspace = decode<{ id: string; resumeKey: string }>(await call('browser_workspaces', { action: 'create', storage: 'scratch', name: 'Marker continuity' }))
    const args = { workspaceId: workspace.id }
    decode(await call('browser_new_tab', { ...args, url: origin }))
    await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => webContents.getAllWebContents().some(page => page.getURL().startsWith(origin) && !page.isLoading()), origin)).toBe(true)
    decode(await call('browser_continuity', { ...args, action: 'checkpoint', markerSelector: '#marker' }))
    await appWindow.evaluate('window.hronautMcp.setPaused(true)')
    await changeMarker('Synthetic changed marker')
    await appWindow.evaluate('window.hronautMcp.setPaused(false)')
    const changed = decode<{ reasons: string[] }>(await call('browser_continuity', { ...args, action: 'status' }))
    expect(changed.reasons).toContain('MARKER_CHANGED')
    expect(changed.reasons).not.toContain('NAVIGATION_CHANGED')
    expect(JSON.stringify(changed)).not.toContain('Synthetic')
    expect(JSON.stringify(changed)).not.toContain('#marker')
    expect((await call('browser_evaluate', { ...args, script: 'window.markerWrite = 1' })).isError).toBe(true)
    for (const interruption of ['navigation', 'pause', 'access', 'reconcile-access'] as const) {
      let pendingRead: Promise<CallToolResult> | undefined
      const review = interruption === 'reconcile-access'
        ? decode<{ reviewId: string }>(await call('browser_continuity', { ...args, action: 'status' })) : undefined
      try {
        await electronApp.evaluate(({ webContents }, origin) => {
          const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))
          if (!page) throw new Error('Missing marker fixture page')
          const original = page.executeJavaScriptInIsolatedWorld
          const state = globalThis as typeof globalThis & { __markerWaiting?: boolean; __markerRelease?: () => void; __markerRestore?: () => void }
          state.__markerRestore = () => { page.executeJavaScriptInIsolatedWorld = original }
          page.executeJavaScriptInIsolatedWorld = async function (...args) {
            const value = await original.apply(this, args)
            if (args[0] !== 1010) return value
            page.executeJavaScriptInIsolatedWorld = original
            state.__markerWaiting = true
            await new Promise<void>(resolve => { state.__markerRelease = resolve })
            return value
          }
        }, origin)
        pendingRead = call('browser_continuity', { ...args, action: review ? 'reconcile' : 'status', ...(review ? { reviewId: review.reviewId } : {}) })
        await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { __markerWaiting?: boolean }).__markerWaiting)).toBe(true)
        if (interruption === 'navigation') {
          await electronApp.evaluate(async ({ webContents }, origin) => {
            const page = webContents.getAllWebContents().find(page => page.getURL().startsWith(origin))
            if (!page) throw new Error('Missing marker fixture page')
            await page.loadURL(`${origin}/changed-during-marker`)
          }, origin)
        } else if (interruption === 'access' || interruption === 'reconcile-access') {
          await appWindow.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(workspace.id)}, { agentAccess: false })`)
        } else {
          await appWindow.evaluate('window.hronautMcp.setPaused(true)')
          await appWindow.evaluate('window.hronautMcp.setPaused(false)')
        }
        await electronApp.evaluate(() => (globalThis as typeof globalThis & { __markerRelease?: () => void }).__markerRelease?.())
        const result = await pendingRead
        if (interruption === 'access' || interruption === 'reconcile-access') {
          expect(result.isError).toBe(true)
          const humanReport = await appWindow.evaluate(`window.hronaut.reviewWorkspaceContinuity(${JSON.stringify(workspace.id)})`)
          expect(humanReport).toMatchObject({ suspended: true })
        } else {
          const interruptedReport = decode(result)
          expect(interruptedReport, `${interruption}: ${JSON.stringify(interruptedReport)}`).toMatchObject({ status: 'BLOCKED', suspended: true, reviewId: null })
        }
        expect((await call('browser_evaluate', { ...args, script: 'window.markerWrite = 1' })).isError).toBe(true)
      } finally {
        await electronApp.evaluate(() => {
          const state = globalThis as typeof globalThis & { __markerWaiting?: boolean; __markerRelease?: () => void; __markerRestore?: () => void }
          state.__markerRelease?.(); state.__markerRestore?.()
          delete state.__markerWaiting; delete state.__markerRelease; delete state.__markerRestore
        })
        await pendingRead?.catch(() => undefined)
        if (interruption === 'access' || interruption === 'reconcile-access') {
          await appWindow.evaluate(`window.hronaut.updateTabGroup(${JSON.stringify(workspace.id)}, { agentAccess: true })`)
          decode(await call('browser_workspaces', { ...args, action: 'resume', resumeKey: workspace.resumeKey }))
        }
      }
    }
    for (const unavailable of [null, 'é'.repeat(257)]) {
      await changeMarker(unavailable)
      expect(decode(await call('browser_continuity', { ...args, action: 'status' }))).toMatchObject({ status: 'BLOCKED', reviewId: null })
    }
    await changeMarker('Synthetic reviewed marker')
    const review = decode<{ reviewId: string }>(await call('browser_continuity', { ...args, action: 'status' }))
    decode(await call('browser_continuity', { ...args, action: 'reconcile', reviewId: review.reviewId }))
    // Explicitly replacing the checkpoint without a selector removes the opt-in.
    decode(await call('browser_continuity', { ...args, action: 'checkpoint' }))
    await changeMarker(null)
    expect(decode(await call('browser_continuity', { ...args, action: 'status' }))).toMatchObject({ status: 'PASS' })
  } finally {
    await client.close()
    await closeFixtureServer(fixture)
  }
})
