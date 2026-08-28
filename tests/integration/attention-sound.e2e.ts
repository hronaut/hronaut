import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './fixtures.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'

process.env.HRONAUT_INTEGRATION_TEST_HOOKS = '1'
test.afterAll(() => { delete process.env.HRONAUT_INTEGRATION_TEST_HOOKS })

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

test('previews and plays the selected Foley cue for user attention', async ({
  appWindow,
  mcpPort,
  mcpToken
}) => {
  const authorization = `Bearer ${mcpToken}`
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    })
    .toBe(true)

  await appWindow.evaluate(`(() => {
    const audioContext = window.AudioContext
    const originalCreateOscillator = audioContext.prototype.createOscillator
    Object.defineProperty(window, '__hronautFoleyOscillators', { value: 0, writable: true })
    audioContext.prototype.createOscillator = function () {
      window.__hronautFoleyOscillators += 1
      return originalCreateOscillator.call(this)
    }
  })()`)
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  await appWindow.getByRole('combobox', { name: 'Attention sound' }).selectOption('bell')
  await appWindow.getByRole('button', { name: 'Test sound' }).click()
  await expect.poll(() => appWindow.evaluate('window.__hronautFoleyOscillators')).toBeGreaterThan(0)
  const previewOscillators = await appWindow.evaluate('window.__hronautFoleyOscillators') as number
  await appWindow.waitForTimeout(100)

  const client = new Client({ name: 'hronaut-attention-sound-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    await client.connect(transport)
    await useMcpWorkspace(client, 'Attention sound tests')
    await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { reason: 'Please complete this manual step.' }
    })
    await expect.poll(() => appWindow.evaluate('window.__hronautFoleyOscillators')).toBeGreaterThan(previewOscillators)
  } finally {
    await client.close()
  }
})

test('clears native user attention when its tab or workspace closes', async ({
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const authorization = `Bearer ${mcpToken}`
  await expect
    .poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    })
    .toBe(true)

  const client = new Client({ name: 'hronaut-attention-lifecycle-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    await client.connect(transport)
    const workspaceId = await useMcpWorkspace(client, 'Attention lifecycle tests')
    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautAttentionLifecycleMenu?: { original: typeof Menu.buildFromTemplate; labels: string[] }
      }
      const original = Menu.buildFromTemplate
      scope.__hronautAttentionLifecycleMenu = { original, labels: [] }
      Object.defineProperty(Menu, 'buildFromTemplate', {
        configurable: true,
        value: (template: Electron.MenuItemConstructorOptions[]) => {
          scope.__hronautAttentionLifecycleMenu!.labels = template
            .map((item) => item.label)
            .filter((label): label is string => typeof label === 'string')
          return original.call(Menu, template)
        }
      })
    })
    const initialStatus = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    const requestedTabId = JSON.parse(text(initialStatus)).activeTabId as string

    await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { reason: 'Please review this expiring tab.', tabId: requestedTabId }
    })
    const requestedStatus = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    expect(JSON.parse(text(requestedStatus)).userAttention).toMatchObject({ tabId: requestedTabId })
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __hronautAttentionLifecycleMenu?: { labels: string[] } }
    ).__hronautAttentionLifecycleMenu?.labels ?? [])).toContain('Show requested browser tab')

    await client.callTool({ name: 'browser_close_tab', arguments: { tabId: requestedTabId } })
    await expect.poll(async () => {
      const status = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
      return JSON.parse(text(status)).userAttention
    }).toBeNull()
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __hronautAttentionLifecycleMenu?: { labels: string[] } }
    ).__hronautAttentionLifecycleMenu?.labels ?? [])).not.toContain('Show requested browser tab')

    await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { reason: 'Please review this expiring workspace.' }
    })
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __hronautAttentionLifecycleMenu?: { labels: string[] } }
    ).__hronautAttentionLifecycleMenu?.labels ?? [])).toContain('Show requested browser tab')

    await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'close', workspaceId }
    })
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __hronautAttentionLifecycleMenu?: { labels: string[] } }
    ).__hronautAttentionLifecycleMenu?.labels ?? [])).not.toContain('Show requested browser tab')
  } finally {
    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautAttentionLifecycleMenu?: { original: typeof Menu.buildFromTemplate }
      }
      const control = scope.__hronautAttentionLifecycleMenu
      if (control) Object.defineProperty(Menu, 'buildFromTemplate', { configurable: true, value: control.original })
      delete scope.__hronautAttentionLifecycleMenu
    }).catch(() => undefined)
    await client.close()
  }
})

test('keeps the current tab selected when presentation actions cannot wake their target', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Rejected tray request</title><main>Tray request fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const authorization = `Bearer ${mcpToken}`
  const client = new Client({ name: 'hronaut-attention-tray-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Tray request fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/rejected-tray-request`
    await expect
      .poll(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
        } catch {
          return false
        }
      })
      .toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Attention tray tests')
    const navigated = await client.callTool({
      name: 'browser_navigate',
      arguments: { url }
    }) as CallToolResult
    expect(navigated.isError, text(navigated)).not.toBe(true)
    const targetTabId = (JSON.parse(text(navigated)) as { activeTabId: string }).activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { tabId: targetTabId } })
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: 'about:blank', active: true }
    }) as CallToolResult
    const fallbackTabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId

    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautTrayRequestMenu?: { original: typeof Menu.buildFromTemplate; menu?: Electron.Menu }
      }
      const original = Menu.buildFromTemplate
      scope.__hronautTrayRequestMenu = { original }
      Object.defineProperty(Menu, 'buildFromTemplate', {
        configurable: true,
        value: (template: Electron.MenuItemConstructorOptions[]) => {
          const menu = original.call(Menu, template)
          if (menu.items.some((item) => item.label === 'Show requested browser tab')) {
            scope.__hronautTrayRequestMenu!.menu = menu
          }
          return menu
        }
      })
    })
    const attention = await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { reason: 'Please review the sleeping tray tab.', tabId: targetTabId }
    }) as CallToolResult
    expect(attention.isError, text(attention)).not.toBe(true)
    await electronApp.evaluate(({ Menu }) => {
      const control = (globalThis as typeof globalThis & {
        __hronautTrayRequestMenu?: { original: typeof Menu.buildFromTemplate; menu?: Electron.Menu }
      }).__hronautTrayRequestMenu
      if (!control?.menu) throw new Error('Requested-tab tray menu was not captured')
      Object.defineProperty(Menu, 'buildFromTemplate', { configurable: true, value: control.original })
    })

    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(fallbackTabId)})`)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      sleeping: state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    }))`)).toEqual({ activeTabId: fallbackTabId, sleeping: true })

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping tray request WebContents was not found')
      const scope = globalThis as typeof globalThis & {
        __hronautRejectedTrayWake?: {
          pageId: number
          restore: Electron.NavigationHistory['restore']
          loadUrl: Electron.WebContents['loadURL']
        }
      }
      scope.__hronautRejectedTrayWake = {
        pageId: page.id,
        restore: page.navigationHistory.restore.bind(page.navigationHistory),
        loadUrl: page.loadURL.bind(page)
      }
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => { throw new Error('simulated requested tray wake failure') }
      })
      Object.defineProperty(page, 'loadURL', {
        configurable: true,
        value: async () => { throw new Error('simulated requested tray wake failure') }
      })
    })

    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & {
        __hronautTrayRequestMenu?: { menu?: Electron.Menu }
      }).__hronautTrayRequestMenu?.menu
      const item = menu?.items.find((candidate) => candidate.label === 'Show requested browser tab')
      if (!item?.click) throw new Error('Requested-tab tray action was not found')
      item.click(item, undefined, { triggeredByAccelerator: false })
    })
    await expect(appWindow.getByText('simulated requested tray wake failure')).toBeVisible()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      sleeping: state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    }))`)).toEqual({ activeTabId: fallbackTabId, sleeping: true })
    const retainedAttention = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    expect(JSON.parse(text(retainedAttention)).userAttention).toMatchObject({
      reason: 'Please review the sleeping tray tab.',
      tabId: targetTabId
    })

    const requested = await client.callTool({
      name: 'browser_request_user_attention',
      arguments: { reason: 'Please retry the sleeping tab.', tabId: targetTabId }
    }) as CallToolResult
    expect(requested.isError).toBe(true)
    expect(text(requested)).toContain('simulated requested tray wake failure')
    const status = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    expect(JSON.parse(text(status)).userAttention).toMatchObject({
      reason: 'Please review the sleeping tray tab.',
      tabId: targetTabId
    })
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      sleeping: state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    }))`)).toEqual({ activeTabId: fallbackTabId, sleeping: true })
  } finally {
    await electronApp.evaluate(({ Menu, webContents }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautTrayRequestMenu?: { original: typeof Menu.buildFromTemplate }
        __hronautRejectedTrayWake?: {
          pageId: number
          restore: Electron.NavigationHistory['restore']
          loadUrl: Electron.WebContents['loadURL']
        }
      }
      const menuControl = scope.__hronautTrayRequestMenu
      if (menuControl) {
        Object.defineProperty(Menu, 'buildFromTemplate', { configurable: true, value: menuControl.original })
        delete scope.__hronautTrayRequestMenu
      }
      const wakeControl = scope.__hronautRejectedTrayWake
      const page = wakeControl ? webContents.fromId(wakeControl.pageId) : undefined
      if (wakeControl && page) {
        Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: wakeControl.restore })
        Object.defineProperty(page, 'loadURL', { configurable: true, value: wakeControl.loadUrl })
      }
      delete scope.__hronautRejectedTrayWake
    }).catch(() => undefined)
    await client.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps newer user attention authoritative when an older tab wake finishes later', async ({
  appWindow,
  electronApp,
  mcpPort,
  mcpToken
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Delayed attention request</title><main>Delayed attention fixture</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  const authorization = `Bearer ${mcpToken}`
  const client = new Client({ name: 'hronaut-attention-authority-test', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
    requestInit: { headers: { authorization } }
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Delayed attention fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/delayed-attention-request`
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization } })).ok
      } catch {
        return false
      }
    }).toBe(true)
    await client.connect(transport)
    await useMcpWorkspace(client, 'Attention authority tests')
    const navigated = await client.callTool({ name: 'browser_navigate', arguments: { url } }) as CallToolResult
    const targetTabId = (JSON.parse(text(navigated)) as { activeTabId: string }).activeTabId
    await client.callTool({ name: 'browser_wait', arguments: { tabId: targetTabId } })
    const opened = await client.callTool({
      name: 'browser_new_tab',
      arguments: { url: 'about:blank', active: true }
    }) as CallToolResult
    const fallbackTabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((tab) => tab.id === ${JSON.stringify(targetTabId)})?.sleeping
    ))`)).toBe(true)

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Delayed attention WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = {
        pageId: page.id,
        restore: originalRestore,
        started: false,
        release: undefined as (() => void) | undefined
      }
      ;(globalThis as typeof globalThis & { __hronautDelayedAttentionWake?: typeof control }).__hronautDelayedAttentionWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    })

    await electronApp.evaluate(async (_electron, input) => {
      const requestUserAttention = (globalThis as typeof globalThis & {
        __hronautRequestUserAttentionForTest?: (request: { reason: string; tabId?: string }) => Promise<unknown>
      }).__hronautRequestUserAttentionForTest
      if (!requestUserAttention) throw new Error('Attention integration hook is unavailable')
      const pending = requestUserAttention({
        reason: 'Older delayed attention.',
        tabId: input.targetTabId
      }).then(
        () => ({ error: null }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) })
      )
      ;(globalThis as typeof globalThis & {
        __hronautPendingAttentionRequest?: Promise<{ error: string | null }>
      }).__hronautPendingAttentionRequest = pending
    }, { targetTabId })
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedAttentionWake?: { started: boolean } })
        .__hronautDelayedAttentionWake?.started ?? false
    ))).toBe(true)

    await electronApp.evaluate(async (_electron, input) => {
      const requestUserAttention = (globalThis as typeof globalThis & {
        __hronautRequestUserAttentionForTest?: (request: { reason: string; tabId?: string }) => Promise<unknown>
      }).__hronautRequestUserAttentionForTest
      if (!requestUserAttention) throw new Error('Attention integration hook is unavailable')
      await requestUserAttention({
        reason: 'Newer authoritative attention.',
        tabId: input.fallbackTabId
      })
      const control = (globalThis as typeof globalThis & {
        __hronautDelayedAttentionWake?: { release?: () => void }
      }).__hronautDelayedAttentionWake
      if (!control?.release) throw new Error('Delayed attention wake was not waiting')
      control.release()
    }, { fallbackTabId })

    const olderResult = await electronApp.evaluate(async () => {
      const pending = (globalThis as typeof globalThis & {
        __hronautPendingAttentionRequest?: Promise<{ error: string | null }>
      }).__hronautPendingAttentionRequest
      if (!pending) throw new Error('Delayed attention request was not captured')
      return pending
    })
    expect(olderResult.error).toBe('User attention request was superseded by a newer request.')
    const status = await client.callTool({ name: 'browser_status', arguments: {} }) as CallToolResult
    expect(JSON.parse(text(status)).userAttention).toMatchObject({
      reason: 'Newer authoritative attention.',
      tabId: fallbackTabId
    })
  } finally {
    await electronApp.evaluate(({ webContents }) => {
      const scope = globalThis as typeof globalThis & {
        __hronautDelayedAttentionWake?: { pageId: number; restore: Electron.NavigationHistory['restore']; release?: () => void }
        __hronautPendingAttentionRequest?: Promise<unknown>
      }
      scope.__hronautDelayedAttentionWake?.release?.()
      const control = scope.__hronautDelayedAttentionWake
      const page = control ? webContents.fromId(control.pageId) : undefined
      if (control && page) {
        Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
      }
      delete scope.__hronautDelayedAttentionWake
      delete scope.__hronautPendingAttentionRequest
    }).catch(() => undefined)
    await client.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
