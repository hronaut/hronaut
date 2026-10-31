import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'

type SaveDialog = { defaultPath?: string }

// After a restart, the first save dialog opened in the download folder rather than in the folder the last one saved
// into: the look at that folder, made as the browser was built, came before the browser had its settings, and failed.

test('starts the first save dialog after a restart in the folder the last one saved into, as in Chrome', async ({
  profileDirectory,
  mcpPort
}) => {
  const folder = mkdtempSync(join(tmpdir(), 'hronaut-save-dialog-startup-'))
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Saved after restart</title><p>A page to save</p>')
  })
  let instance: Awaited<ReturnType<typeof launchHronaut>> | undefined
  try {
    await writeFile(join(profileDirectory, 'settings.json'), `${JSON.stringify({
      theme: 'system', interfaceScale: 1, tabPosition: 'top', mcpToolSet: 'complete', mcpAuthentication: false,
      saveDialogDirectory: folder
    }, null, 2)}\n`, 'utf8')
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const url = `http://127.0.0.1:${address.port}/page`
    instance = await launchHronaut(profileDirectory, mcpPort)
    const { app, window } = instance
    // The system dialog is out of reach here: note where it is asked to start, and cancel it.
    await app.evaluate(({ dialog }) => {
      const state = globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[] }
      state.__saveDialogs = []
      dialog.showSaveDialog = (async (_window: unknown, options: SaveDialog) => {
        state.__saveDialogs!.push({ defaultPath: options.defaultPath })
        return { canceled: true, filePath: '' }
      }) as typeof dialog.showSaveDialog
    })
    await window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })`)
    await expect.poll(() => app.evaluate(({ webContents }, address) => (
      webContents.getAllWebContents().some((candidate) => candidate.getURL() === address && !candidate.isLoading())
    ), url)).toBe(true)

    // View → Save Page As…, from the menu rather than with Ctrl+S, which needs the window to have the keyboard.
    await app.evaluate(({ BrowserWindow, Menu }) => {
      const item = Menu.getApplicationMenu()?.items.find((candidate) => candidate.label === 'View')
        ?.submenu?.items.find((candidate) => candidate.label === 'Save Page As…')
      if (!item?.click) throw new Error('Missing View → Save Page As…')
      item.click(item, BrowserWindow.getAllWindows()[0], {} as Electron.KeyboardEvent)
    })
    await expect.poll(() => app.evaluate(() => (
      (globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[] }).__saveDialogs!.length
    ))).toBe(1)
    const asked = await app.evaluate(() => (globalThis as typeof globalThis & { __saveDialogs?: SaveDialog[] }).__saveDialogs![0]!)
    expect(dirname(asked.defaultPath ?? '')).toBe(folder)
    // Nor was main left with a promise rejected as it started.
    expect(await app.evaluate(() => process.exitCode ?? 0)).toBe(0)
  } finally {
    if (instance) await closeHronaut(instance.app)
    await closeFixtureServer(server)
    rmSync(folder, { recursive: true, force: true })
  }
})
