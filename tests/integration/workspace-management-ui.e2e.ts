import { createServer } from 'node:http'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('forks independent workspace data, edits agent access, and moves between archived workspaces through the editor', async ({ appWindow, electronApp }, testInfo) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Workspace management fixture</title><main>Independent data</main>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture port is unavailable')
    const origin = `http://127.0.0.1:${address.port}`
    const sourceUrl = `${origin}/source`
    const sourceState = await appWindow.evaluate("window.hronaut.createWorkspace({ name: 'Personal source', storage: 'scratch', agentAccess: false })") as BrowserState
    const source = sourceState.mcpTabGroups.find(group => group.name === 'Personal source')!
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(sourceState.activeTabId)}, url: ${JSON.stringify(sourceUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), sourceUrl)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      await contents.executeJavaScript("localStorage.setItem('workspace-ui-key', 'source-value')")
      await contents.session.cookies.set({ url, name: 'workspace-ui-cookie', value: 'source-value' })
    }, sourceUrl)

    await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
    const create = appWindow.getByRole('dialog', { name: 'Create workspace', exact: true })
    await create.getByLabel('Workspace name', { exact: true }).fill('Independent fork')
    await create.getByRole('radio', { name: 'Fork a workspace' }).check()
    await create.getByLabel('Source workspace', { exact: true }).selectOption(source.id)
    await expect(create.getByText(origin, { exact: true })).toBeVisible()
    const access = create.getByRole('checkbox', { name: 'Allow direct agent access' })
    await access.uncheck()
    await expect(create.getByText('Agents can still fork this workspace into an independent copy.', { exact: true })).toBeVisible()
    for (const width of [1200, 640]) {
      await electronApp.evaluate(({ BrowserWindow }, width) => {
        const window = BrowserWindow.getAllWindows()[0]!
        window.setMinimumSize(600, 600)
        window.setSize(width, 800)
      }, width)
      await expect.poll(() => appWindow.evaluate(() => window.innerWidth)).toBe(width)
      expect(await create.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await expect(create.locator('footer').getByRole('button', { name: 'Create workspace', exact: true })).toBeInViewport()
      await appWindow.screenshot({ path: testInfo.outputPath(`workspace-fork-${width}.png`) })
    }
    await create.locator('footer').getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(create).toBeHidden()
    const forkState = await appWindow.evaluate('window.hronaut.getState()') as BrowserState
    const fork = forkState.mcpTabGroups.find(group => group.name === 'Independent fork')!
    expect(fork.agentAccess).toBe(false)
    expect(forkState.tabs.filter(tab => tab.mcpGroupId === fork.id).map(tab => tab.url)).toEqual(['about:blank'])
    const forkUrl = `${origin}/fork`
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(forkState.activeTabId)}, url: ${JSON.stringify(forkUrl)} })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), forkUrl)).toBe(true)
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return { value: await contents.executeJavaScript("localStorage.getItem('workspace-ui-key')"), cookies: (await contents.session.cookies.get({ name: 'workspace-ui-cookie' })).map(cookie => cookie.value) }
    }, forkUrl)).toEqual({ value: 'source-value', cookies: ['source-value'] })

    await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), fork.id)
    const edit = appWindow.getByRole('dialog', { name: 'Edit workspace', exact: true })
    await expect(edit.getByRole('checkbox', { name: 'Allow direct agent access' })).not.toBeChecked()
    await edit.getByRole('checkbox', { name: 'Allow direct agent access' }).check()
    await edit.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(edit).toBeHidden()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.mcpTabGroups.find(group => group.id === ${JSON.stringify(fork.id)})?.agentAccess)`)).toBe(true)

    await appWindow.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(source.id)})`)
    await appWindow.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(fork.id)})`)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.mcpTabGroups.length)')).toBe(0)
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    const overview = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
    await overview.getByRole('button', { name: 'Transfer browser data', exact: true }).click()
    await expect(overview).toBeHidden()
    const transfer = appWindow.getByRole('dialog', { name: 'Transfer browser data', exact: true })
    await expect(transfer).toBeVisible()
    await expect(transfer.getByLabel('Workspace name', { exact: true })).toHaveCount(0)
    await transfer.getByLabel('Source workspace', { exact: true }).selectOption(source.id)
    await transfer.getByLabel('Destination workspace', { exact: true }).selectOption(fork.id)
    await transfer.getByRole('radio', { name: 'Move', exact: true }).check()
    await expect(transfer.getByText(origin, { exact: true })).toBeVisible()
    const move = transfer.getByRole('button', { name: 'Move selected data', exact: true })
    await expect(move).toBeEnabled()
    for (const width of [640, 1200]) {
      await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 800), width)
      await expect.poll(() => appWindow.evaluate(() => window.innerWidth)).toBe(width)
      await move.scrollIntoViewIfNeeded()
      expect(await transfer.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      await expect(transfer.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
      await appWindow.screenshot({ path: testInfo.outputPath(`workspace-move-${width}.png`) })
    }
    appWindow.once('dialog', dialog => { void dialog.accept() })
    await move.click()
    await expect(transfer.getByRole('status').filter({ hasText: 'Moved 1 cookies and 1 local storage items.' })).toBeVisible()
    await transfer.getByRole('button', { name: 'Close', exact: true }).click()
    await appWindow.evaluate(`window.hronaut.restoreSavedTabGroup(${JSON.stringify(source.id)})`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), sourceUrl)).toBe(true)
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return { value: await contents.executeJavaScript("localStorage.getItem('workspace-ui-key')"), cookies: await contents.session.cookies.get({ name: 'workspace-ui-cookie' }) }
    }, sourceUrl)).toEqual({ value: null, cookies: [] })
    await appWindow.evaluate(`window.hronaut.restoreSavedTabGroup(${JSON.stringify(fork.id)})`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(contents => contents.getURL() === url), forkUrl)).toBe(true)
    expect(await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      return { value: await contents.executeJavaScript("localStorage.getItem('workspace-ui-key')"), cookies: (await contents.session.cookies.get({ name: 'workspace-ui-cookie' })).map(cookie => cookie.value) }
    }, forkUrl)).toEqual({ value: 'source-value', cookies: ['source-value'] })
  } finally { await closeFixtureServer(server) }
})
