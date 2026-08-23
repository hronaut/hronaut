import { createServer } from 'node:http'
import { closeHronaut, expect, launchHronaut, test, type HronautInstance } from './fixtures.js'
import type { BrowserState } from '../../src/shared/types.js'

test('shows two live tabs, changes their layout, and exits split view', async ({ appWindow, electronApp }) => {
  const firstUrl = 'data:text/html,<title>Split Alpha</title><h1>Alpha pane</h1>'
  const secondUrl = 'data:text/html,<title>Split Beta</title><h1>Beta pane</h1>'
  const firstState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(firstUrl)}, active: true })`) as BrowserState
  const firstTabId = firstState.activeTabId!
  const secondState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(secondUrl)}, active: false })`) as BrowserState
  const secondTabId = secondState.tabs.find((tab) => tab.id !== firstTabId && !tab.url.startsWith('hronaut://home'))!.id

  await expect(appWindow.getByRole('tab', { name: /^Split Beta/ })).toBeVisible()
  await electronApp.evaluate(({ Menu }) => {
    ;(globalThis as typeof globalThis & { __hronautSplitMenu?: Electron.Menu }).__hronautSplitMenu = undefined
    Menu.prototype.popup = function (): void {
      ;(globalThis as typeof globalThis & { __hronautSplitMenu?: Electron.Menu }).__hronautSplitMenu = this
    }
  })
  await appWindow.getByRole('tab', { name: /^Split Beta/ }).click({ button: 'right' })
  await expect.poll(() => electronApp.evaluate(() => {
    const menu = (globalThis as typeof globalThis & { __hronautSplitMenu?: Electron.Menu }).__hronautSplitMenu
    const item = menu?.getMenuItemById('open-in-split-view')
    return { label: item?.label, enabled: item?.enabled }
  })).toEqual({ label: 'Open in Split View', enabled: true })

  const splitViewButton = appWindow.getByRole('button', { name: 'Split view', exact: true })
  await expect(splitViewButton).toBeVisible()
  await splitViewButton.click()
  await expect(appWindow.getByRole('dialog', { name: 'Split view' })).toBeVisible()
  await appWindow.getByRole('button', { name: 'Open Hronaut Home' }).click()
  await expect(splitViewButton).toBeHidden()
  await appWindow.getByRole('tab', { name: /^Split Alpha/ }).click()
  await expect(splitViewButton).toHaveAttribute('aria-expanded', 'false')
  await expect(appWindow.getByRole('dialog', { name: 'Split view' })).toBeHidden()
  await splitViewButton.click()
  await appWindow.locator('.split-candidate-list').getByRole('button', { name: /Split Beta/ }).click()

  await expect.poll(() => appWindow.evaluate('window.hronaut.getState()')).toMatchObject({
    activeTabId: firstTabId,
    splitView: {
      firstTabId,
      secondTabId,
      orientation: 'vertical',
      ratio: 0.5
    }
  })
  const visibleViews = () => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    return (mainWindow?.contentView.children ?? [])
      .filter((view): view is InstanceType<typeof WebContentsView> => view instanceof WebContentsView)
      .map((view) => ({ title: view.webContents.getTitle(), bounds: view.getBounds() }))
  })
  await expect.poll(visibleViews).toEqual(expect.arrayContaining([
    expect.objectContaining({ title: 'Split Alpha' }),
    expect.objectContaining({ title: 'Split Beta' })
  ]))
  const sideBySide = await visibleViews()
  const alphaSide = sideBySide.find((view) => view.title === 'Split Alpha')!.bounds
  const betaSide = sideBySide.find((view) => view.title === 'Split Beta')!.bounds
  expect(alphaSide.x).toBeLessThan(betaSide.x)
  expect(alphaSide.y).toBe(betaSide.y)
  expect(Math.abs(alphaSide.width - betaSide.width)).toBeLessThanOrEqual(1)

  await electronApp.evaluate(({ BrowserWindow, WebContentsView }) => {
    const beta = BrowserWindow.getAllWindows()[0]?.contentView.children
      .find((view): view is InstanceType<typeof WebContentsView> => view instanceof WebContentsView && view.webContents.getTitle() === 'Split Beta')
    if (!beta) throw new Error('Split Beta view was not found')
    beta.webContents.focus()
    beta.webContents.sendInputEvent({ type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 })
    beta.webContents.sendInputEvent({ type: 'mouseUp', x: 10, y: 10, button: 'left', clickCount: 1 })
  })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(secondTabId)
  await expect(appWindow.locator('.tab.split-visible')).toHaveCount(2)

  await appWindow.getByRole('button', { name: 'Split view', exact: true }).click()
  await appWindow.getByRole('button', { name: 'Stacked', exact: true }).click()
  await expect.poll(async () => (await visibleViews()).find((view) => view.title === 'Split Beta')?.bounds.y).toBeGreaterThan(
    (await visibleViews()).find((view) => view.title === 'Split Alpha')!.bounds.y
  )

  await appWindow.locator('.split-ratio-control input').evaluate((input) => {
    Reflect.set(input, 'value', '25')
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView?.ratio)')).toBe(0.25)

  await appWindow.getByRole('button', { name: 'Swap panes' }).click()
  await expect.poll(async () => {
    const views = await visibleViews()
    return views.find((view) => view.title === 'Split Beta')!.bounds.y < views.find((view) => view.title === 'Split Alpha')!.bounds.y
  }).toBe(true)

  await appWindow.getByRole('button', { name: 'Exit split view' }).click()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeUndefined()
  await expect.poll(async () => (await visibleViews()).length).toBe(1)

  await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(firstTabId)})`)
  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(secondTabId)})`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(firstTabId)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeUndefined()
  await expect.poll(async () => (await visibleViews()).map((view) => view.title)).toEqual(['Split Alpha'])
})

test('keeps the current pane when a sleeping split target cannot wake and permits a retry', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Rejected sleeping split</title><main>Split retry restored this page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Rejected sleeping-split fixture did not expose a port')
    const targetUrl = `http://127.0.0.1:${address.port}/rejected-sleeping-split`
    const firstUrl = 'data:text/html,<title>Split wake survivor</title><main>Split wake survivor</main>'
    const first = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(firstUrl)}, active: true })`) as BrowserState
    const firstTabId = first.activeTabId!
    const target = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(targetUrl)}, active: false })`) as BrowserState
    const targetTabId = target.tabs.find((tab) => tab.url === targetUrl)!.id
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((candidate) => candidate.id === ${JSON.stringify(targetTabId)})?.loading
    ))`)).toBe(false)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Sleeping split fixture WebContents was not found')
      const control = {
        pageId: page.id,
        restore: page.navigationHistory.restore.bind(page.navigationHistory),
        loadUrl: page.loadURL.bind(page)
      }
      ;(globalThis as typeof globalThis & { __hronautRejectedSplitWake?: typeof control }).__hronautRejectedSplitWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async () => { throw new Error('simulated sleeping split wake failure') }
      })
      Object.defineProperty(page, 'loadURL', {
        configurable: true,
        value: async () => { throw new Error('simulated sleeping split wake failure') }
      })
    })

    await appWindow.getByRole('button', { name: 'Split view', exact: true }).click()
    await appWindow.locator('.split-candidate-list').getByRole('button', { name: /Rejected sleeping split/ }).click()
    await expect(appWindow.getByRole('alert', { name: 'Split view failed' })).toContainText('simulated sleeping split wake failure')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      splitView: state.splitView ?? null,
      sleeping: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(targetTabId)})?.sleeping
    }))`)).toEqual({ activeTabId: firstTabId, splitView: null, sleeping: true })
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => (
      (BrowserWindow.getAllWindows()[0]?.contentView.children ?? [])
        .filter((view) => view instanceof WebContentsView)
        .map((view) => view.webContents.getTitle())
    ))).toEqual(['Split wake survivor'])

    await electronApp.evaluate(({ webContents }) => {
      const control = (globalThis as typeof globalThis & {
        __hronautRejectedSplitWake?: { pageId: number; restore: Electron.NavigationHistory['restore']; loadUrl: Electron.WebContents['loadURL'] }
      }).__hronautRejectedSplitWake
      if (!control) throw new Error('Rejected split wake control was not found')
      const page = webContents.fromId(control.pageId)
      if (!page) throw new Error('Sleeping split fixture WebContents disappeared')
      Object.defineProperty(page.navigationHistory, 'restore', { configurable: true, value: control.restore })
      Object.defineProperty(page, 'loadURL', { configurable: true, value: control.loadUrl })
      delete (globalThis as typeof globalThis & { __hronautRejectedSplitWake?: unknown }).__hronautRejectedSplitWake
    })
    await appWindow.getByRole('button', { name: 'Split view', exact: true }).click()
    await appWindow.locator('.split-candidate-list').getByRole('button', { name: /Rejected sleeping split/ }).click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      splitView: state.splitView,
      sleeping: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(targetTabId)})?.sleeping
    }))`)).toMatchObject({
      splitView: { firstTabId, secondTabId: targetTabId },
      sleeping: false
    })
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, targetUrl)).toContain('Split retry restored this page')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('does not open a delayed sleeping split target after a newer tab selection', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Delayed sleeping split</title><main>Delayed split restored this page</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Delayed sleeping-split fixture did not expose a port')
    const targetUrl = `http://127.0.0.1:${address.port}/delayed-sleeping-split`
    const firstUrl = 'data:text/html,<title>Delayed split survivor</title><main>Delayed split survivor</main>'
    const first = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(firstUrl)}, active: true })`) as BrowserState
    const firstTabId = first.activeTabId!
    const target = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(targetUrl)}, active: false })`) as BrowserState
    const targetTabId = target.tabs.find((tab) => tab.url === targetUrl)!.id
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => (
      state.tabs.find((candidate) => candidate.id === ${JSON.stringify(targetTabId)})?.loading
    ))`)).toBe(false)
    await appWindow.evaluate(`window.hronaut.setTabSleeping(${JSON.stringify(targetTabId)}, true)`)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))?.id ?? null
    ))).toBeTruthy()

    await electronApp.evaluate(({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL().includes('%3Ctitle%3ESleeping%20tab'))
      if (!page) throw new Error('Delayed split fixture WebContents was not found')
      const originalRestore = page.navigationHistory.restore.bind(page.navigationHistory)
      const control = { started: false, release: undefined as (() => void) | undefined }
      ;(globalThis as typeof globalThis & { __hronautDelayedSplitWake?: typeof control }).__hronautDelayedSplitWake = control
      Object.defineProperty(page.navigationHistory, 'restore', {
        configurable: true,
        value: async (...args: Parameters<typeof originalRestore>) => {
          control.started = true
          await new Promise<void>((resolve) => { control.release = resolve })
          return originalRestore(...args)
        }
      })
    })

    await appWindow.getByRole('button', { name: 'Split view', exact: true }).click()
    await appWindow.locator('.split-candidate-list').getByRole('button', { name: /Delayed sleeping split/ }).click()
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __hronautDelayedSplitWake?: { started: boolean } })
        .__hronautDelayedSplitWake?.started ?? false
    ))).toBe(true)
    await appWindow.getByRole('tab', { name: /^Delayed split survivor/ }).click()
    await electronApp.evaluate(() => {
      const control = (globalThis as typeof globalThis & {
        __hronautDelayedSplitWake?: { release?: () => void }
      }).__hronautDelayedSplitWake
      if (!control?.release) throw new Error('Delayed split wake was not waiting')
      control.release()
    })

    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      splitView: state.splitView ?? null,
      sleeping: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(targetTabId)})?.sleeping,
      loading: state.tabs.find((candidate) => candidate.id === ${JSON.stringify(targetTabId)})?.loading
    }))`)).toEqual({ activeTabId: firstTabId, splitView: null, sleeping: false, loading: false })
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => (
      (BrowserWindow.getAllWindows()[0]?.contentView.children ?? [])
        .filter((view) => view instanceof WebContentsView)
        .map((view) => view.webContents.getTitle())
    ))).toEqual(['Delayed split survivor'])
    await expect.poll(() => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
      return page?.executeJavaScript('document.body.innerText')
    }, targetUrl)).toContain('Delayed split restored this page')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('restores both split panes and their layout after restart', async ({ profileDirectory, mcpPort }) => {
  let first: HronautInstance | undefined
  let second: HronautInstance | undefined
  try {
    first = await launchHronaut(profileDirectory, mcpPort)
    const firstState = await first.window.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Persistent Alpha</title>', active: true })`) as BrowserState
    const firstTabId = firstState.activeTabId!
    const nextState = await first.window.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Persistent Beta</title>', active: false })`) as BrowserState
    const secondTabId = nextState.tabs.find((tab) => tab.id !== firstTabId && !tab.url.startsWith('hronaut://home'))!.id
    await first.window.evaluate(`window.hronaut.openSplitView(${JSON.stringify(secondTabId)})`)
    await first.window.evaluate(`window.hronaut.updateSplitView({ orientation: 'horizontal', ratio: 0.4 })`)
    await closeHronaut(first.app)
    first = undefined

    second = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => second!.window.evaluate('window.hronaut.getState()')).toMatchObject({
      activeTabId: firstTabId,
      splitView: {
        firstTabId,
        secondTabId,
        orientation: 'horizontal',
        ratio: 0.4
      }
    })
    await expect.poll(() => second!.app.evaluate(({ BrowserWindow }) => (
      BrowserWindow.getAllWindows()[0]?.contentView.children.length
    ))).toBe(2)
  } finally {
    if (first) await closeHronaut(first.app)
    if (second) await closeHronaut(second.app)
  }
})

test('rejects a destroyed split target without corrupting the active tab or later close operations', async ({
  appWindow,
  electronApp
}) => {
  const activeUrl = 'data:text/html,<title>Live split source</title><h1>Live source</h1>'
  const destroyedUrl = 'data:text/html,<title>Destroyed split target</title><h1>Destroyed target</h1>'
  const activeState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(activeUrl)}, active: true })`) as BrowserState
  const activeTabId = activeState.activeTabId!
  const targetState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(destroyedUrl)}, active: false })`) as BrowserState
  const targetTabId = targetState.tabs.find((tab) => tab.url === destroyedUrl)!.id

  await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().some((contents) => contents.getURL() === url)
  ), destroyedUrl)).toBe(true)
  await electronApp.evaluate(({ webContents }, url) => {
    const target = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!target) throw new Error('Destroyed split target was not found')
    target.close()
  }, destroyedUrl)

  await appWindow.getByRole('button', { name: 'Split view', exact: true }).click()
  await appWindow.locator('.split-candidate-list').getByRole('button', { name: /Destroyed split target/ }).click()
  await expect(appWindow.getByRole('alert', { name: 'Split view failed' })).toContainText(
    'selected tab renderer is no longer available'
  )
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(activeTabId)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeUndefined()

  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(targetTabId)})`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(activeTabId)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeUndefined()

  const recoveryUrl = 'data:text/html,<title>Live split recovery</title><h1>Live recovery</h1>'
  const recoveryState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(recoveryUrl)}, active: false })`) as BrowserState
  const recoveryTabId = recoveryState.tabs.find((tab) => tab.url === recoveryUrl)!.id
  await electronApp.evaluate(({ webContents }, url) => {
    const active = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!active) throw new Error('Live split source was not found')
    active.close()
  }, activeUrl)

  await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
    activeTabId: state.activeTabId,
    staleProblem: state.tabs.find((tab) => tab.id === ${JSON.stringify(activeTabId)})?.pageProblem
  }))`)).toMatchObject({
    activeTabId: expect.not.stringMatching(String(activeTabId)),
    staleProblem: {
      kind: 'renderer-gone',
      title: 'This page is no longer available'
    }
  })
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeUndefined()

  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(activeTabId)})`)
  await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(recoveryTabId)})`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(recoveryTabId)
})

test('collapses an open split when Electron destroys either native pane', async ({ appWindow, electronApp }) => {
  const firstUrl = 'data:text/html,<title>Split survivor</title><h1>Survivor</h1>'
  const secondUrl = 'data:text/html,<title>Split teardown</title><h1>Teardown</h1>'
  const firstState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(firstUrl)}, active: true })`) as BrowserState
  const firstTabId = firstState.activeTabId!
  const secondState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(secondUrl)}, active: false })`) as BrowserState
  const secondTabId = secondState.tabs.find((tab) => tab.url === secondUrl)!.id
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().some((contents) => contents.getURL() === url)
  ), secondUrl)).toBe(true)
  await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(secondTabId)})`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeDefined()

  await electronApp.evaluate(({ webContents }, url) => {
    const pane = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!pane) throw new Error('Split teardown pane was not found')
    pane.close()
  }, secondUrl)

  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeUndefined()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(firstTabId)
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => (
    (BrowserWindow.getAllWindows()[0]?.contentView.children ?? [])
      .filter((view) => view instanceof WebContentsView)
      .map((view) => view.webContents.getTitle())
  ))).toEqual(['Split survivor'])
  await appWindow.getByRole('tab', { name: /Split teardown/ }).click()
  await expect(appWindow.getByRole('alert', { name: 'Open tab failed' })).toContainText(
    'tab renderer is no longer available'
  )
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(firstTabId)

  await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(secondTabId)})`)
  const activeTeardownUrl = 'data:text/html,<title>Active split teardown</title><h1>Active teardown</h1>'
  const activeTeardownState = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(activeTeardownUrl)}, active: false })`) as BrowserState
  const activeTeardownTabId = activeTeardownState.tabs.find((tab) => tab.url === activeTeardownUrl)!.id
  await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().some((contents) => contents.getURL() === url)
  ), activeTeardownUrl)).toBe(true)
  await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(activeTeardownTabId)})`)
  await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(activeTeardownTabId)})`)
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(activeTeardownTabId)

  await electronApp.evaluate(({ webContents }, url) => {
    const pane = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    if (!pane) throw new Error('Active split teardown pane was not found')
    pane.close()
  }, activeTeardownUrl)

  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.splitView)')).toBeUndefined()
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.activeTabId)')).toBe(firstTabId)
  await expect.poll(() => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => (
    (BrowserWindow.getAllWindows()[0]?.contentView.children ?? [])
      .filter((view) => view instanceof WebContentsView)
      .map((view) => view.webContents.getTitle())
  ))).toEqual(['Split survivor'])
})
