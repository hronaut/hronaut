import { mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import type { BrowserState } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('serializes Memory Saver settings and sleeps eligible tabs without stale shell state', async ({
  appWindow,
  profileDirectory
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Memory Saver fixture</title><main>Eligible website tab</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Memory Saver fixture server did not expose a port')
  const websiteUrl = `http://127.0.0.1:${address.port}/`

  try {
    await appWindow.evaluate(`(async () => {
      const url = ${JSON.stringify(websiteUrl)};
      await window.hronaut.newTab({ url, active: true });
      await window.hronaut.newTab({ url, active: true });
    })()`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => {
      const tabs = state.tabs.filter((tab) => tab.url === ${JSON.stringify(websiteUrl)});
      return {
        count: tabs.length,
        active: tabs.filter((tab) => tab.active).length,
        loading: tabs.filter((tab) => tab.loading).length
      };
    })`)).toEqual({ count: 2, active: 1, loading: 0 })

    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.getByRole('button', { name: /Performance/ }).click()
    const automatic = appWindow.getByRole('checkbox', { name: 'Automatically sleep inactive tabs' })
    const timeout = appWindow.getByRole('combobox', { name: 'Sleep after' })
    const sleepNow = appWindow.getByRole('button', { name: 'Sleep eligible tabs now' })
    await expect(appWindow.getByText('0 sleeping')).toBeVisible()
    await expect(appWindow.getByText('of 2 website tabs')).toBeVisible()
    await expect(automatic).toBeChecked()
    await expect(timeout).toHaveValue('60')

    const settingsPath = join(profileDirectory, 'settings.json')
    const blockedTemporaryPath = `${settingsPath}.tmp`
    await rm(blockedTemporaryPath, { recursive: true, force: true })
    await mkdir(blockedTemporaryPath)
    try {
      await automatic.click()
      await expect(appWindow.getByRole('alert', { name: 'Setting not saved' })).toBeVisible()
      await expect(automatic).toBeChecked()
      await expect(timeout).toHaveValue('60')
      await expect.poll(() => appWindow.evaluate('window.hronautSettings.get()')).toMatchObject({
        memorySaverEnabled: true,
        memorySaverTimeoutMinutes: 60
      })
    } finally {
      await rm(blockedTemporaryPath, { recursive: true, force: true })
    }

    await timeout.selectOption('15')
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: 15
    })

    await sleepNow.click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.filter((tab) => tab.url === ${JSON.stringify(websiteUrl)} && tab.sleeping).length
    ))`)).toBe(1)
    await expect(appWindow.getByText('1 sleeping')).toBeVisible()
    await automatic.uncheck()
    await expect(automatic).not.toBeChecked()
    await expect(sleepNow).toBeDisabled()
    await expect(appWindow.getByText('0 sleeping')).toBeVisible()

    await appWindow.getByRole('button', { name: 'Reset to default' }).click()
    await expect(automatic).toBeChecked()
    await expect(timeout).toHaveValue('60')
    await expect.poll(async () => JSON.parse(await readFile(settingsPath, 'utf8'))).toMatchObject({
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: 60
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('sleeps only eligible inactive tabs in the selected workspace', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((request, response) => {
    const fixture = request.url?.slice(1) || 'unknown'
    const titles: Record<string, string> = {
      active: 'Workspace active tab',
      eligible: 'Workspace eligible tab',
      dirty: 'Workspace dirty form',
      pinned: 'Workspace pinned tab',
      other: 'Other workspace tab'
    }
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${titles[fixture] ?? 'Unknown fixture'}</title>
      <main>${fixture}</main>${fixture === 'dirty' ? '<input aria-label="Unsaved workspace input" value="">' : ''}`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Workspace sleep fixture did not expose a port')
    const origin = `http://127.0.0.1:${address.port}`
    const workspace = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Sleep research', storage: 'scratch' })`) as BrowserState
    const workspaceId = workspace.mcpTabGroups.find((group) => group.name === 'Sleep research')?.id
    if (!workspaceId) throw new Error('Sleep research workspace was not created')
    const activeTabId = workspace.activeTabId
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(activeTabId)}, url: ${JSON.stringify(`${origin}/active`)} })`)
    for (const fixture of ['eligible', 'dirty', 'pinned']) {
      await appWindow.evaluate(`window.hronaut.newTab({
        url: ${JSON.stringify(`${origin}/${fixture}`)},
        active: false,
        mcpGroupId: ${JSON.stringify(workspaceId)}
      })`)
    }
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.filter((tab) => tab.mcpGroupId === ${JSON.stringify(workspaceId)} && tab.url.startsWith(${JSON.stringify(origin)})).map((tab) => tab.title).sort()
    ))`)).toEqual([
      'Workspace active tab',
      'Workspace dirty form',
      'Workspace eligible tab',
      'Workspace pinned tab'
    ])
    const fixtureIds = await appWindow.evaluate(`window.hronaut.getState().then((state) => Object.fromEntries(
      state.tabs.filter((tab) => tab.mcpGroupId === ${JSON.stringify(workspaceId)}).map((tab) => [new URL(tab.url).pathname.slice(1), tab.id])
    ))`) as Record<string, string>
    await appWindow.evaluate(`window.hronaut.setTabPinned(${JSON.stringify(fixtureIds.pinned)}, true)`)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Workspace dirty form WebContents was not found')
      await contents.executeJavaScript(`(() => {
        const input = document.querySelector('input');
        input.value = 'unfinished';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
    }, `${origin}/dirty`)

    const otherWorkspace = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Other research', storage: 'scratch' })`) as BrowserState
    const otherWorkspaceId = otherWorkspace.mcpTabGroups.find((group) => group.name === 'Other research')?.id
    if (!otherWorkspaceId) throw new Error('Other research workspace was not created')
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(otherWorkspace.activeTabId)}, url: ${JSON.stringify(`${origin}/other`)} })`)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(activeTabId)})`)

    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __hronautWorkspaceSleepMenu?: Electron.Menu }).__hronautWorkspaceSleepMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __hronautWorkspaceSleepMenu?: Electron.Menu }).__hronautWorkspaceSleepMenu = this
      }
    })
    await appWindow.locator('.tab-group-label', { hasText: 'Sleep research' }).click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautWorkspaceSleepMenu?: Electron.Menu }).__hronautWorkspaceSleepMenu
      return menu?.getMenuItemById('sleep-workspace-tabs')?.label ?? null
    })).toBe('Sleep Eligible Tabs')
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __hronautWorkspaceSleepMenu?: Electron.Menu }).__hronautWorkspaceSleepMenu
      const item = menu?.getMenuItemById('sleep-workspace-tabs')
      if (!item?.click) throw new Error('Sleep Eligible Tabs context action was not found')
      ;(item.click as unknown as () => void)()
    })

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => Object.fromEntries(
      state.tabs.filter((tab) => tab.url.startsWith(${JSON.stringify(origin)})).map((tab) => [new URL(tab.url).pathname.slice(1), tab.sleeping])
    ))`)).toEqual({
      active: false,
      eligible: true,
      dirty: false,
      pinned: false,
      other: false
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('keeps a tab awake when it becomes visible during the form-safety check', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html>
      <title>Memory Saver race fixture</title>
      <input aria-label="Unchanged field" value="">
      <script>window.__memorySaverDocumentIdentity = crypto.randomUUID()</script>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Memory Saver race fixture did not expose a port')
    const websiteUrl = `http://127.0.0.1:${address.port}/`
    await appWindow.evaluate(`(async () => {
      await window.hronaut.newTab({ url: ${JSON.stringify(websiteUrl)}, active: true });
      await window.hronaut.newTab({ url: 'about:blank', active: true });
    })()`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === "Memory Saver race fixture")?.id)')).toBeTruthy()
    const tabId = await appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.title === "Memory Saver race fixture")?.id)') as string
    const documentIdentity = await electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Memory Saver race fixture WebContents was not found')
      return page.executeJavaScript('window.__memorySaverDocumentIdentity') as Promise<string>
    }, websiteUrl)

    await electronApp.evaluate(({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      if (!page) throw new Error('Memory Saver race fixture WebContents was not found')
      const originalExecuteJavaScript = page.executeJavaScript.bind(page)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautFormSafetyCheck?: typeof control }).__hronautFormSafetyCheck = control
      Object.defineProperty(page, 'executeJavaScript', {
        configurable: true,
        value: (code: string, userGesture?: boolean) => {
          if (code.includes('window.__hronautContentEditableDirty === true')) {
            control.started = true
            return new Promise<boolean>((resolve) => {
              control.release = () => resolve(false)
            })
          }
          return originalExecuteJavaScript(code, userGesture)
        }
      })
    }, websiteUrl)

    await appWindow.evaluate(`(() => {
      window.__hronautMemorySaverRace = window.hronaut.sleepInactiveTabs();
    })()`)
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautFormSafetyCheck?: { started: boolean } })
        .__hronautFormSafetyCheck?.started ?? false
    ))).toBe(true)
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautFormSafetyCheck?: { release?: () => void }
      }).__hronautFormSafetyCheck
      if (!control?.release) throw new Error('Memory Saver form-safety check was not waiting')
      control.release()
    })
    await appWindow.evaluate('window.__hronautMemorySaverRace')

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      active: state.activeTabId === ${JSON.stringify(tabId)},
      sleeping: state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.sleeping
    }))`)).toEqual({ active: true, sleeping: false })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('window.__memorySaverDocumentIdentity') ?? null
    }, websiteUrl)).toBe(documentIdentity)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
