import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

function template(names: string[], url = ''): string {
  return JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'windows', workspaces: names.map(name => ({ name, color: 'blue', startPages: url ? [`${url}/${name}`] : [] })) })
}

test('imports fresh isolated profiles without sharing authenticated storage or selecting their tabs', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Template isolation</title><main>Synthetic fixture</main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const origin = `http://127.0.0.1:${address.port}`
    const source = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.createWorkspace({ name: 'Existing source', storage: 'scratch' }))
    await appWindow.evaluate(input => (window as unknown as { hronaut: HronautApi }).hronaut.navigate(input), { tabId: source.activeTabId!, url: `${origin}/source` })
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url), `${origin}/source`)).toBe(true)
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.session.cookies.set({ url, name: 'session-sentinel', value: 'source-only' })
      await page.executeJavaScript("localStorage.setItem('sentinel', 'source-only')")
    }, `${origin}/source`)
    const result = await appWindow.evaluate(text => (window as unknown as { hronaut: HronautApi }).hronaut.importWorkspaceTemplate(text), template(['First', 'Second'], origin))
    expect(result.status).toBe('completed')
    expect(new Set(result.workspaceIds).size).toBe(2)
    expect(result.state.activeTabId).toBe(source.activeTabId)
    for (const id of result.workspaceIds) expect(result.state.mcpTabGroups.find(group => group.id === id)).toMatchObject({ storageKind: 'isolated', agentAccess: false })
    for (const name of ['First', 'Second']) {
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().some(page => page.getURL() === url), `${origin}/${name}`)).toBe(true)
      expect(await electronApp.evaluate(async ({ webContents }, url) => {
        const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
        return { cookies: await page.session.cookies.get({ url }), storage: await page.executeJavaScript("localStorage.getItem('sentinel')") }
      }, `${origin}/${name}`)).toEqual({ cookies: [], storage: null })
    }
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page => page.getURL() === url)!
      await page.session.cookies.set({ url, name: 'session-sentinel', value: 'first-only' })
    }, `${origin}/First`)
    expect(await electronApp.evaluate(async ({ webContents }, origin) => {
      const values = []
      for (const path of ['source', 'First', 'Second']) {
        const page = webContents.getAllWebContents().find(page => page.getURL() === `${origin}/${path}`)!
        values.push((await page.session.cookies.get({ url: `${origin}/${path}` })).map(cookie => cookie.value))
      }
      return values
    }, origin)).toEqual([['source-only'], ['first-only'], []])
  } finally {
    await closeFixtureServer(server)
  }
})

test('rejects collisions and rolls back new profiles when initial tab rendering fails', async ({ appWindow, electronApp }) => {
  const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  await electronApp.evaluate(({ WebContentsView }) => {
    const original = WebContentsView.prototype.setBounds
    WebContentsView.prototype.setBounds = function (bounds) {
      if (!this.webContents.getURL()) {
        WebContentsView.prototype.setBounds = original
        throw new Error('simulated imported tab failure')
      }
      return original.call(this, bounds)
    }
  })
  const failed = await appWindow.evaluate(text => (window as unknown as { hronaut: HronautApi }).hronaut.importWorkspaceTemplate(text), template(['First', 'Second']))
  expect(failed.status).toBe('rolled-back')
  expect(failed.workspaceIds).toEqual([])
  expect(failed.state.mcpTabGroups).toEqual(before.mcpTabGroups)
  const created = await appWindow.evaluate(text => (window as unknown as { hronaut: HronautApi }).hronaut.importWorkspaceTemplate(text), template(['First']))
  expect(created.status).toBe('completed')
  const collision = await appWindow.evaluate(async text => {
    try { await (window as unknown as { hronaut: HronautApi }).hronaut.importWorkspaceTemplate(text); return 'unexpected success' } catch (error) { return String(error) }
  }, template(['FIRST']))
  expect(collision).toContain('collisions')
  const after = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  expect(after.mcpTabGroups.map(group => group.id)).toEqual(created.state.mcpTabGroups.map(group => group.id))
})

test('native file selection previews without profile changes and export writes only reviewed metadata', async ({ appWindow, electronApp, profileDirectory }) => {
  const { writeFile, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const source = join(profileDirectory, 'selected-template.json')
  const destination = join(profileDirectory, 'exported-template.json')
  const manifest = template(['Portable'])
  await writeFile(source, manifest)
  const before = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
  await electronApp.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.source] })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: paths.destination })
  }, { source, destination })
  expect(await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.openWorkspaceTemplateFile())).toBe(manifest)
  expect((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).mcpTabGroups).toEqual(before.mcpTabGroups)
  expect(await appWindow.evaluate(text => (window as unknown as { hronaut: HronautApi }).hronaut.saveWorkspaceTemplateFile(text), manifest)).toBe(true)
  expect(JSON.parse(await readFile(destination, 'utf8'))).toEqual(JSON.parse(manifest))
  await electronApp.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
  })
  expect(await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.openWorkspaceTemplateFile())).toBeNull()
  expect(await appWindow.evaluate(text => (window as unknown as { hronaut: HronautApi }).hronaut.saveWorkspaceTemplateFile(text), manifest)).toBe(false)
  expect((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).mcpTabGroups).toEqual(before.mcpTabGroups)
})

test('invalid file selection hides filesystem paths and invalid export preserves its destination', async ({ appWindow, electronApp, profileDirectory }) => {
  const { writeFile, readFile } = await import('node:fs/promises')
  const { join } = await import('node:path')
  const destination = join(profileDirectory, 'keep-template.json')
  await writeFile(destination, 'keep existing file')
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path + '.missing'] })
    dialog.showSaveDialog = async () => { throw new Error('Invalid input must not open a save dialog') }
  }, destination)
  const error = await appWindow.evaluate(async () => {
    try { await (window as unknown as { hronaut: HronautApi }).hronaut.openWorkspaceTemplateFile(); return '' } catch (error) { return String(error) }
  })
  expect(error).toContain('could not be read')
  expect(error).not.toContain(profileDirectory)
  const invalid = await appWindow.evaluate(async () => {
    try { await (window as unknown as { hronaut: HronautApi }).hronaut.saveWorkspaceTemplateFile('{'); return '' } catch (error) { return String(error) }
  })
  expect(invalid).toContain('not valid JSON')
  expect(await readFile(destination, 'utf8')).toBe('keep existing file')
})
