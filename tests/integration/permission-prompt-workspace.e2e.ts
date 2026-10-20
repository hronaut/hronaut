import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('a site permission prompt names the workspace the choice is remembered in', async ({ appWindow, electronApp }) => {
  // A tab in another workspace, such as one an agent works in, could ask while the person looked at their own, and the
  // prompt said only "this workspace".
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Workspace prompt</title><p>Workspace prompt</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    await appWindow.evaluate(async url => {
      const hronaut = (window as unknown as { hronaut: HronautApi }).hronaut
      const { activeTabId } = await hronaut.newTab({ url, active: true })
      const state = await hronaut.getState()
      const workspaceId = state.tabs.find(tab => tab.id === activeTabId)?.mcpGroupId
      if (!workspaceId) throw new Error('Missing fixture workspace')
      await hronaut.updateTabGroup(workspaceId, { name: 'Client A' })
    }, origin)
    await expect.poll(() => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().some((contents) => contents.getTitle() === 'Workspace prompt')
    ))).toBe(true)
    await electronApp.evaluate(({ dialog }) => {
      const prompts: string[] = []
      ;(globalThis as typeof globalThis & { __workspacePrompts?: string[] }).__workspacePrompts = prompts
      dialog.showMessageBox = async (...args: unknown[]) => {
        const options = args.at(-1) as Electron.MessageBoxOptions
        prompts.push(`${String(options.message)}\n${String(options.detail)}`)
        return { response: 0, checkboxChecked: false }
      }
    })
    await electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Workspace prompt')
      if (!page) throw new Error('Permission fixture web contents was not found')
      await page.executeJavaScript('navigator.storage.persist().catch(() => undefined); true', true)
    })
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __workspacePrompts?: string[] }
    ).__workspacePrompts?.[0])).toBe(`${origin} requests “Persistent storage” permission.\n`
      + 'Hronaut remembers this choice for this website in the “Client A” workspace. You can change it later in Settings → Site permissions.')
  } finally {
    await closeFixtureServer(server)
  }
})
