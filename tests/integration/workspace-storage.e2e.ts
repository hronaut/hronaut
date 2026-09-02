import { createServer } from 'node:http'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('isolates workspace profiles and explicitly forks or saves data through Default', async ({
  appWindow,
  electronApp
}) => {
  let internalTransferRequests = 0
  const requestCookies = new Map<string, string>()
  const server = createServer((request, response) => {
    if (request.url?.includes('.well-known/hronaut-workspace-storage')) internalTransferRequests += 1
    requestCookies.set(request.url ?? '/', request.headers.cookie ?? '')
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      ...(request.url === '/seed-default'
        ? { 'set-cookie': [
            'workspace-cookie=default; HttpOnly; Path=/; SameSite=Lax',
            'path-cookie=default-private; HttpOnly; Path=/private; SameSite=Lax'
          ] }
        : request.url === '/seed-secondary'
          ? { 'set-cookie': 'secondary-cookie=default; HttpOnly; Path=/; SameSite=Lax' }
        : {})
    })
    response.end('<!doctype html><title>Workspace storage fixture</title><main>Ready</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Workspace storage fixture did not expose a port')
    const origin = `http://127.0.0.1:${address.port}`
    const secondaryOrigin = `http://localhost:${address.port}`
    const defaultUrl = `${origin}/seed-default`
    const secondaryDefaultUrl = `${secondaryOrigin}/seed-secondary`
    const scratchUrl = `${origin}/inspect-scratch`
    const scratchReferenceUrl = `${origin}/inspect-scratch-reference`
    const forkUrl = `${origin}/inspect-fork`
    const freshUrl = `${origin}/inspect-fresh`

    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(defaultUrl)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), defaultUrl)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Default workspace page was not found')
      await contents.executeJavaScript("localStorage.setItem('workspace-key', 'default-value')")
    }, defaultUrl)

    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(secondaryDefaultUrl)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), secondaryDefaultUrl)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Secondary Default workspace page was not found')
      await contents.executeJavaScript("localStorage.setItem('secondary-key', 'secondary-default')")
    }, secondaryDefaultUrl)

    const defaultWorkspaceId = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.find((workspace) => workspace.isDefault)?.id)`) as string
    const scratchState = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Scratch isolation', storage: 'scratch' })`) as {
      activeTabId: string
      mcpTabGroups: Array<{ id: string; name: string; storageKind: string }>
    }
    const scratchWorkspace = scratchState.mcpTabGroups.find((workspace) => workspace.name === 'Scratch isolation')
    expect(scratchWorkspace).toMatchObject({ storageKind: 'isolated' })
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(scratchState.activeTabId)}, url: ${JSON.stringify(scratchUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), scratchUrl)).toBe(true)
    const scratchData = await electronApp.evaluate(async ({ webContents }, input) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === input.url)
      if (!contents) throw new Error('Scratch workspace page was not found')
      ;(globalThis as typeof globalThis & { __scratchWorkspaceSession?: Electron.Session }).__scratchWorkspaceSession = contents.session
      return {
        localStorage: await contents.executeJavaScript("localStorage.getItem('workspace-key')"),
        cookies: (await contents.session.cookies.get({})).map((cookie) => `${cookie.name}=${cookie.value}`)
      }
    }, { url: scratchUrl, origin })
    expect(scratchData).toEqual({ localStorage: null, cookies: [] })
    expect(requestCookies.get('/inspect-scratch')).not.toContain('workspace-cookie=default')

    const scratchReferenceState = await appWindow.evaluate(`window.hronaut.newTab({
      url: ${JSON.stringify(scratchReferenceUrl)},
      active: false,
      mcpGroupId: ${JSON.stringify(scratchWorkspace!.id)}
    })`) as { tabs: Array<{ id: string; url: string }> }
    const scratchReferenceTabId = scratchReferenceState.tabs.find((tab) => tab.url === scratchReferenceUrl)?.id
    if (!scratchReferenceTabId) throw new Error('Scratch reference tab was not created')
    await appWindow.evaluate(`window.hronaut.setTabPinned(${JSON.stringify(scratchReferenceTabId)}, true)`)
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(scratchReferenceTabId)}, true)`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), scratchReferenceUrl)).toBe(true)

    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Scratch workspace page was not found')
      await contents.executeJavaScript("localStorage.setItem('scratch-only', 'temporary')")
      await contents.session.cookies.set({ url, name: 'scratch-only', value: 'temporary', path: '/' })
    }, scratchUrl)
    expect(await electronApp.evaluate(async (_electron, input) => {
      const heldSession = (globalThis as typeof globalThis & { __scratchWorkspaceSession?: Electron.Session }).__scratchWorkspaceSession!
      return (await heldSession.cookies.get({ url: `${input.origin}/` })).length
    }, { origin })).toBe(1)

    await electronApp.evaluate(async () => {
      const heldSession = (globalThis as typeof globalThis & { __scratchWorkspaceSession?: Electron.Session }).__scratchWorkspaceSession
      if (!heldSession) throw new Error('Scratch workspace session was not retained for the destruction failure check')
      const originalClearData = heldSession.clearData.bind(heldSession)
      heldSession.clearData = async (..._args: Parameters<Electron.Session['clearData']>) => {
        heldSession.clearData = originalClearData
        throw new Error('simulated workspace storage deletion failure')
      }
    })
    const failedClose = await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(scratchWorkspace!.id)}).then(() => 'closed', (error) => String(error.message ?? error))`)
    expect(failedClose).toContain('simulated workspace storage deletion failure')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      workspace: state.mcpTabGroups.find((workspace) => workspace.id === ${JSON.stringify(scratchWorkspace!.id)}),
      tabs: state.tabs.filter((tab) => tab.mcpGroupId === ${JSON.stringify(scratchWorkspace!.id)}),
      activeTabId: state.activeTabId
    }))`)).toMatchObject({
      workspace: {
        name: 'Scratch isolation',
        tabCount: 2,
        storageKind: 'isolated'
      },
      tabs: expect.arrayContaining([
        expect.objectContaining({ id: scratchState.activeTabId, url: scratchUrl, active: true }),
        expect.objectContaining({ id: scratchReferenceTabId, url: scratchReferenceUrl, pinned: true, humanInteractionLocked: true })
      ]),
      activeTabId: scratchState.activeTabId
    })
    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(scratchWorkspace!.id)})`)
    await expect.poll(() => electronApp.evaluate(async (_electron, input) => {
      const heldSession = (globalThis as typeof globalThis & { __scratchWorkspaceSession?: Electron.Session }).__scratchWorkspaceSession
      if (!heldSession) throw new Error('Scratch workspace session was not retained for the destruction check')
      return (await heldSession.cookies.get({ url: `${input.origin}/` })).length
    }, { origin })).toBe(0)

    const partialState = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Partial fork', storage: 'fork-default', origins: [${JSON.stringify(origin)}] })`) as {
      activeTabId: string
      mcpTabGroups: Array<{ id: string; name: string }>
    }
    const partialWorkspace = partialState.mcpTabGroups.find((workspace) => workspace.name === 'Partial fork')!
    const partialSecondaryUrl = `${secondaryOrigin}/inspect-partial-secondary`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(partialState.activeTabId)}, url: ${JSON.stringify(partialSecondaryUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), partialSecondaryUrl)).toBe(true)
    const excludedData = await electronApp.evaluate(async ({ webContents }, input) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === input.url)
      if (!contents) throw new Error('Partial workspace page was not found')
      return {
        localStorage: await contents.executeJavaScript("localStorage.getItem('secondary-key')"),
        cookies: (await contents.session.cookies.get({ url: `${input.origin}/` })).map((cookie) => cookie.name)
      }
    }, { url: partialSecondaryUrl, origin: secondaryOrigin })
    expect(excludedData).toEqual({ localStorage: null, cookies: [] })
    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(partialWorkspace.id)})`)

    const forkState = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Forked default', storage: 'fork-default' })`) as {
      activeTabId: string
      mcpTabGroups: Array<{ id: string; name: string; storageKind: string }>
    }
    const forkWorkspace = forkState.mcpTabGroups.find((workspace) => workspace.name === 'Forked default')!
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(forkState.activeTabId)}, url: ${JSON.stringify(forkUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), forkUrl)).toBe(true)
    const forkData = await electronApp.evaluate(async ({ webContents }, input) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === input.url)
      if (!contents) throw new Error('Forked workspace page was not found')
      return {
        localStorage: await contents.executeJavaScript("localStorage.getItem('workspace-key')"),
        cookies: (await contents.session.cookies.get({})).map((cookie) => `${cookie.name}=${cookie.value}`)
      }
    }, { url: forkUrl, origin })
    expect(forkData.localStorage).toBe('default-value')
    expect(forkData.cookies).toContain('workspace-cookie=default')
    expect(forkData.cookies).toContain('path-cookie=default-private')
    expect(requestCookies.get('/inspect-fork')).toContain('workspace-cookie=default')

    const directionState = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Direction source', storage: 'scratch' })`) as {
      activeTabId: string
      mcpTabGroups: Array<{ id: string; name: string }>
    }
    const directionWorkspace = directionState.mcpTabGroups.find((workspace) => workspace.name === 'Direction source')!
    const directionUrl = `${origin}/direction-source`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(directionState.activeTabId)}, url: ${JSON.stringify(directionUrl)} })`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.listWorkspaceStorageOrigins(${JSON.stringify(directionWorkspace.id)})`)).toEqual([origin])
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Direction workspace page was not found')
      await contents.executeJavaScript("localStorage.setItem('direction-only', 'isolated')")
      await contents.session.cookies.set({ url, name: 'direction-only', value: 'isolated', path: '/' })
    }, directionUrl)
    await appWindow.getByRole('button', { name: 'Site controls for 127.0.0.1' }).click()
    const directionSiteControls = appWindow.getByRole('dialog', { name: '127.0.0.1' })
    await expect(directionSiteControls.getByLabel('1 cookie available to this address')).toBeVisible()
    await directionSiteControls.getByRole('button', { name: 'Site storage' }).click()
    const directionStorage = appWindow.getByRole('dialog', { name: 'Site storage · 127.0.0.1' })
    await expect(directionStorage).toBeVisible()
    await expect(directionStorage.getByText('direction-only', { exact: true })).toBeVisible()
    await directionStorage.getByRole('button', { name: 'Close site storage' }).click()
    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as typeof globalThis & { __workspaceStorageMenu?: Electron.Menu }).__workspaceStorageMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as typeof globalThis & { __workspaceStorageMenu?: Electron.Menu }).__workspaceStorageMenu = this
      }
    })
    await appWindow.locator('.tab.active').click({ button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => Boolean(
      (globalThis as typeof globalThis & { __workspaceStorageMenu?: Electron.Menu })
        .__workspaceStorageMenu?.getMenuItemById('edit-workspace')
    ))).toBe(true)
    await electronApp.evaluate(() => {
      const menu = (globalThis as typeof globalThis & { __workspaceStorageMenu?: Electron.Menu }).__workspaceStorageMenu
      const item = menu?.getMenuItemById('edit-workspace')
      if (!item?.click) throw new Error('Edit Workspace context action was not found')
      ;(item.click as unknown as () => void)()
    })
    const transferEditor = appWindow.getByRole('dialog', { name: 'Edit workspace' })
    await expect(transferEditor.getByText(secondaryOrigin, { exact: true })).toBeVisible()
    await transferEditor.getByRole('radio', { name: 'Save to Default' }).click()
    await expect(transferEditor.getByText(secondaryOrigin, { exact: true })).toBeHidden()
    await expect(transferEditor.getByText(origin, { exact: true })).toBeVisible()
    await transferEditor.getByRole('button', { name: 'Cancel' }).click()
    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(directionWorkspace.id)})`)

    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Forked workspace page was not found for rollback setup')
      await contents.session.cookies.set({ url, name: 'workspace-cookie', value: 'fork-before-failure', path: '/', httpOnly: true, sameSite: 'lax' })
      const originalSet = contents.session.cookies.set.bind(contents.session.cookies)
      let writeCount = 0
      contents.session.cookies.set = async (...args: Parameters<Electron.Cookies['set']>) => {
        writeCount += 1
        if (writeCount === 2) {
          contents.session.cookies.set = originalSet
          throw new Error('simulated partial workspace cookie copy failure')
        }
        return originalSet(...args)
      }
    }, forkUrl)
    const failedImport = await appWindow.evaluate(`window.hronaut.transferWorkspaceStorage({ workspaceId: ${JSON.stringify(forkWorkspace.id)}, direction: 'from-default' }).then(() => 'copied', (error) => String(error.message ?? error))`)
    expect(failedImport).toContain('simulated partial workspace cookie copy failure')
    const cookieAfterRollback = await electronApp.evaluate(async ({ webContents }, input) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === input.url)
      if (!contents) throw new Error('Forked workspace page was not found after rollback')
      return (await contents.session.cookies.get({ url: `${input.origin}/`, name: 'workspace-cookie' }))[0]?.value
    }, { url: forkUrl, origin })
    expect(cookieAfterRollback).toBe('fork-before-failure')

    await electronApp.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Forked workspace page was not found for the concurrency check')
      const globals = globalThis as typeof globalThis & {
        __workspaceTransferStarted?: boolean
        __releaseWorkspaceTransfer?: () => void
      }
      let releaseTransfer = (): void => undefined
      const transferGate = new Promise<void>((resolve) => { releaseTransfer = resolve })
      globals.__workspaceTransferStarted = false
      globals.__releaseWorkspaceTransfer = releaseTransfer
      const originalSet = contents.session.cookies.set.bind(contents.session.cookies)
      contents.session.cookies.set = async (...args: Parameters<Electron.Cookies['set']>) => {
        contents.session.cookies.set = originalSet
        globals.__workspaceTransferStarted = true
        await transferGate
        return originalSet(...args)
      }
    }, forkUrl)
    const pendingImport = appWindow.evaluate(`window.hronaut.transferWorkspaceStorage({ workspaceId: ${JSON.stringify(forkWorkspace.id)}, direction: 'from-default' })`) as Promise<{
      cookieCount: number
    }>
    try {
      await expect.poll(() => electronApp.evaluate(() => (
        (globalThis as typeof globalThis & { __workspaceTransferStarted?: boolean }).__workspaceTransferStarted
      ))).toBe(true)
      const closeWhileCopying = await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(forkWorkspace.id)}).then(() => 'closed', (error) => String(error.message ?? error))`)
      expect(closeWhileCopying).toContain('is busy copying workspace storage')
      const secondCopy = await appWindow.evaluate(`window.hronaut.transferWorkspaceStorage({ workspaceId: ${JSON.stringify(forkWorkspace.id)}, direction: 'to-default' }).then(() => 'copied', (error) => String(error.message ?? error))`)
      expect(secondCopy).toContain('Workspace storage is busy copying workspace storage')
      const forkWhileCopying = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Blocked fork', storage: 'fork-default' }).then(() => 'created', (error) => String(error.message ?? error))`)
      expect(forkWhileCopying).toContain('Workspace storage is busy copying workspace storage')
      await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.some((workspace) => workspace.name === 'Blocked fork'))`)).toBe(false)
      const tabOpenedWhileCopying = await appWindow.evaluate(`window.hronaut.newTab({ url: 'about:blank', active: false, mcpGroupId: ${JSON.stringify(forkWorkspace.id)} })`) as {
        mcpTabGroups: Array<{ id: string; tabCount: number }>
      }
      expect(tabOpenedWhileCopying.mcpTabGroups.find((workspace) => workspace.id === forkWorkspace.id)?.tabCount).toBe(2)
      await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.find((workspace) => workspace.id === ${JSON.stringify(forkWorkspace.id)}))`)).toMatchObject({
        name: 'Forked default',
        tabCount: 2
      })
    } finally {
      await electronApp.evaluate(() => {
        const globals = globalThis as typeof globalThis & { __releaseWorkspaceTransfer?: () => void }
        globals.__releaseWorkspaceTransfer?.()
        delete globals.__releaseWorkspaceTransfer
      })
    }
    expect((await pendingImport).cookieCount).toBeGreaterThan(0)

    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
      if (!contents) throw new Error('Forked workspace page was not found')
      await contents.executeJavaScript("localStorage.setItem('workspace-key', 'saved-from-fork')")
      await contents.session.cookies.set({ url, name: 'fork-only', value: 'saved', path: '/' })
    }, forkUrl)
    const transfer = await appWindow.evaluate(`window.hronaut.transferWorkspaceStorage({ workspaceId: ${JSON.stringify(forkWorkspace.id)}, direction: 'to-default' })`) as {
      cookieCount: number
      localStorageItemCount: number
    }
    expect(transfer.cookieCount).toBeGreaterThanOrEqual(2)
    expect(transfer.localStorageItemCount).toBeGreaterThanOrEqual(1)
    const defaultData = await electronApp.evaluate(async ({ webContents }, input) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === input.url)
      if (!contents) throw new Error('Default workspace page was not found')
      return {
        localStorage: await contents.executeJavaScript("localStorage.getItem('workspace-key')"),
        cookies: (await contents.session.cookies.get({ url: `${input.origin}/` })).map((cookie) => `${cookie.name}=${cookie.value}`)
      }
    }, { url: defaultUrl, origin })
    expect(defaultData.localStorage).toBe('saved-from-fork')
    expect(defaultData.cookies).toContain('fork-only=saved')

    const defaultClose = await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(defaultWorkspaceId)}).then(() => 'closed', (error) => String(error.message ?? error))`)
    expect(defaultClose).toContain('Default workspace cannot be closed or deleted')

    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(forkWorkspace.id)})`)
    const freshState = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Fresh after close', storage: 'scratch' })`) as { activeTabId: string }
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(freshState.activeTabId)}, url: ${JSON.stringify(freshUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === url)
    ), freshUrl)).toBe(true)
    const freshData = await electronApp.evaluate(async ({ webContents }, input) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === input.url)
      if (!contents) throw new Error('Fresh workspace page was not found')
      return {
        localStorage: await contents.executeJavaScript("localStorage.getItem('workspace-key')"),
        cookies: (await contents.session.cookies.get({ url: `${input.origin}/` })).map((cookie) => `${cookie.name}=${cookie.value}`)
      }
    }, { url: freshUrl, origin })
    expect(freshData).toEqual({ localStorage: null, cookies: [] })
    expect(internalTransferRequests).toBe(0)
  } finally {
    await closeFixtureServer(server)
  }
})

test('restores the only workspace without leaving a phantom Default tab when profile deletion fails', async ({
  appWindow,
  electronApp
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Only workspace fixture</title>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Only-workspace fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/only-workspace`
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Only isolated workspace', storage: 'scratch' })`) as {
      activeTabId: string
      tabs: Array<{ id: string; mcpGroupId?: string }>
      mcpTabGroups: Array<{ id: string; name: string }>
    }
    const workspaceId = created.mcpTabGroups.find((workspace) => workspace.name === 'Only isolated workspace')!.id
    const workspaceTabId = created.activeTabId
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(workspaceTabId)}, url: ${JSON.stringify(url)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, targetUrl) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === targetUrl)
    ), url)).toBe(true)

    const otherTabIds = created.tabs.filter((tab) => tab.id !== workspaceTabId).map((tab) => tab.id)
    await appWindow.evaluate(`(async () => {
      for (const tabId of ${JSON.stringify(otherTabIds)}) await window.hronaut.closeTab(tabId)
    })()`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.map((tab) => tab.id))')).toEqual([workspaceTabId])

    await electronApp.evaluate(({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl)
      if (!contents) throw new Error('Only-workspace page was not found')
      const browserSession = contents.session
      const originalClearData = browserSession.clearData.bind(browserSession)
      browserSession.clearData = async (..._args: Parameters<Electron.Session['clearData']>) => {
        browserSession.clearData = originalClearData
        throw new Error('simulated only-workspace deletion failure')
      }
    }, url)

    const failedClose = await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(workspaceId)}).then(() => 'closed', (error) => String(error.message ?? error))`)
    expect(failedClose).toContain('simulated only-workspace deletion failure')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) => ({
      activeTabId: state.activeTabId,
      tabs: state.tabs.map((tab) => ({ id: tab.id, mcpGroupId: tab.mcpGroupId })),
      workspaceTabCount: state.mcpTabGroups.find((workspace) => workspace.id === ${JSON.stringify(workspaceId)})?.tabCount
    }))`)).toEqual({
      activeTabId: workspaceTabId,
      tabs: [{ id: workspaceTabId, mcpGroupId: workspaceId }],
      workspaceTabCount: 1
    })

    await appWindow.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(workspaceId)})`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => ({ tabCount: state.tabs.length, workspaceCount: state.mcpTabGroups.length }))')).toEqual({
      tabCount: 1,
      workspaceCount: 1
    })
  } finally {
    await closeFixtureServer(server)
  }
})

test('keeps an isolated workspace profile across restart until the workspace is closed', async ({
  profileDirectory,
  mcpPort
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Persistent workspace fixture</title>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  let instance = await launchHronaut(profileDirectory, mcpPort)
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Persistent workspace fixture did not expose a port')
    const url = `http://127.0.0.1:${address.port}/persistent`
    const created = await instance.window.evaluate(`window.hronaut.createWorkspace({ name: 'Persistent isolated', storage: 'scratch' })`) as {
      activeTabId: string
      mcpTabGroups: Array<{ id: string; name: string }>
    }
    const workspaceId = created.mcpTabGroups.find((workspace) => workspace.name === 'Persistent isolated')!.id
    await instance.window.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(created.activeTabId)}, url: ${JSON.stringify(url)} })`)
    await expect.poll(() => instance.app.evaluate(({ webContents }, targetUrl) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === targetUrl)
    ), url)).toBe(true)
    await instance.app.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl)
      if (!contents) throw new Error('Persistent workspace page was not found')
      await contents.executeJavaScript("localStorage.setItem('persistent-workspace-key', 'survived')")
      await contents.session.cookies.set({
        url: targetUrl,
        name: 'persistent-workspace-cookie',
        value: 'survived',
        path: '/',
        expirationDate: Date.now() / 1_000 + 3_600
      })
      await contents.session.flushStorageData()
    }, url)
    await closeHronaut(instance.app)

    instance = await launchHronaut(profileDirectory, mcpPort)
    await expect.poll(() => instance.window.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.find((workspace) => workspace.id === ${JSON.stringify(workspaceId)}))`)).toMatchObject({
      name: 'Persistent isolated',
      storageKind: 'isolated'
    })
    await expect.poll(() => instance.app.evaluate(({ webContents }, targetUrl) => (
      webContents.getAllWebContents().some((contents) => contents.getURL() === targetUrl)
    ), url)).toBe(true)
    const restored = await instance.app.evaluate(async ({ webContents }, targetUrl) => {
      const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === targetUrl)
      if (!contents) throw new Error('Restored workspace page was not found')
      return {
        localStorage: await contents.executeJavaScript("localStorage.getItem('persistent-workspace-key')"),
        cookies: (await contents.session.cookies.get({ url: targetUrl })).map((cookie) => `${cookie.name}=${cookie.value}`)
      }
    }, url)
    expect(restored.localStorage).toBe('survived')
    expect(restored.cookies).toContain('persistent-workspace-cookie=survived')
    await instance.window.evaluate(`window.hronaut.closeWorkspace(${JSON.stringify(workspaceId)})`)
    await expect.poll(() => instance.window.evaluate(`window.hronaut.getState().then((state) => state.mcpTabGroups.some((workspace) => workspace.id === ${JSON.stringify(workspaceId)}))`)).toBe(false)
  } finally {
    await closeHronaut(instance.app)
    await closeFixtureServer(server)
  }
})
