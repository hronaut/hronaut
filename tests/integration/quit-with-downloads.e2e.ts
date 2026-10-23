import { writeFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { BrowserDownloadState } from '../../src/shared/types.js'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import { answerTrustedDialog, trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

test('asks before Quit cancels a download in progress, and keeps it when asked to', async ({ profileDirectory, mcpPort }) => {
  const held: ServerResponse[] = []
  const server = createServer((request, response) => {
    if (request.url === '/big') {
      response.writeHead(200, { 'content-disposition': 'attachment; filename="big.iso"', 'content-type': 'application/octet-stream', 'content-length': String(4 * 1024 * 1024) })
      response.write(Buffer.alloc(64 * 1024, 1))
      held.push(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Big download fixture</title><a id="big" href="/big">Big</a>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const page = `http://127.0.0.1:${address.port}/`
    // Closing the window quits, rather than hiding it in the tray.
    await writeFile(join(profileDirectory, 'settings.json'), JSON.stringify({ interfaceScale: 1, tabPosition: 'top', mcpToolSet: 'complete', hideInTray: false }))
    const { app, window: appWindow } = await launchHronaut(profileDirectory, mcpPort)
    const child = app.process()
    try {
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(page)}, active: true })`)
      await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.active)?.title)')).toBe('Big download fixture')
      await app.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
        if (!contents) throw new Error('Download fixture web contents was not found')
        await contents.executeJavaScript("document.querySelector('#big').click()")
      }, page)
      const downloads = () => appWindow.evaluate('window.hronautDownloads.list()') as Promise<BrowserDownloadState[]>
      await expect.poll(async () => (await downloads())[0]?.state).toBe('progressing')

      const chooseQuit = () => app.evaluate(({ Menu }) => {
        const find = (items: Electron.MenuItem[]): Electron.MenuItem | undefined => {
          for (const item of items) {
            if (item.accelerator === 'CmdOrCtrl+Q') return item
            const nested = item.submenu && find(item.submenu.items)
            if (nested) return nested
          }
          return undefined
        }
        const quit = find(Menu.getApplicationMenu()?.items ?? [])
        if (!quit) throw new Error('The menu has no Quit')
        quit.click()
      })

      // Quit cancelled the download and deleted its unfinished file without asking. Hronaut now asks in its own dialog
      // over the window, with Keep downloading focused.
      const question = trustedDialog(appWindow)
      await chooseQuit()
      await expect(question).toHaveAttribute('data-topic', 'downloads')
      expect(await trustedDialogHeadline(appWindow)).toBe('A download is in progress.')
      await expect(question).toContainText('Quitting now cancels it and deletes the unfinished file.')
      await expect(question.locator('.ui-dialog__footer button')).toHaveText(['Keep downloading', 'Quit'])
      await expect(question.getByRole('button', { name: 'Keep downloading', exact: true })).toBeFocused()
      await answerTrustedDialog(appWindow, 'Keep downloading')
      await expect(question).toBeHidden()
      // Closing the window quits too, and asks the same.
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((window) => window.getTitle() === 'Hronaut')?.close())
      await expect(question).toHaveAttribute('data-topic', 'downloads')
      await answerTrustedDialog(appWindow, 'Keep downloading')
      await expect(question).toBeHidden()
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(child.exitCode).toBeNull()
      expect((await downloads())[0]?.state).toBe('progressing')

      const exited = new Promise((resolve) => child.once('exit', resolve))
      await chooseQuit()
      // Hronaut quits as soon as the answer arrives, which can close the window under the click.
      await answerTrustedDialog(appWindow, 'Quit').catch(() => undefined)
      await exited
    } finally {
      for (const response of held) response.destroy()
      await closeHronaut(app)
    }
  } finally {
    // The server closes also when Hronaut could not start.
    await closeFixtureServer(server)
  }
})
