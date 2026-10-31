import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type BoxesGlobal = typeof globalThis & { __pageBoxes?: Array<{ message: string, checkboxLabel?: string }> }

test('offers to stop a website\'s boxes from its second one on, as Chrome does', async ({ appWindow, electronApp }) => {
  // A page that showed one confirm box after another held the window, which each box blocks until it is answered,
  // and offered no way to stop them.
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Boxes</title><script>
      window.showBoxes = () => [0, 1, 2, 3].map((index) => confirm('Box ' + index))
    </script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/boxes`
  try {
    // The person answers each box with OK, and ticks the offer to stop them where a box makes it.
    await electronApp.evaluate(({ dialog }) => {
      const seen: Array<{ message: string, checkboxLabel?: string }> = []
      ;(globalThis as BoxesGlobal).__pageBoxes = seen
      dialog.showMessageBox = (async (...args: unknown[]) => {
        const options = (args.length > 1 ? args[1] : args[0]) as Electron.MessageBoxOptions
        seen.push({ message: options.message, checkboxLabel: options.checkboxLabel })
        return { response: 0, checkboxChecked: Boolean(options.checkboxLabel) && seen.length === 2 }
      }) as typeof dialog.showMessageBox
    })
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Boxes', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const workspace = created.mcpTabGroups.find(group => group.name === 'Boxes')!.id
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    await expect.poll(() => electronApp.evaluate(({ webContents }, address) => webContents.getAllWebContents()
      .some(contents => contents.getURL() === address && !contents.isLoading()), url)).toBe(true)

    // A box holds the page and fails the calls waiting on it, so the page shows its boxes on its own and keeps the answers.
    const pageAnswers = (script: string): Promise<unknown> => electronApp.evaluate(async ({ webContents }, { address, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === address)
      if (!page) throw new Error('Boxes page web contents was not found')
      return await page.executeJavaScript(script)
    }, { address: url, script })
    await pageAnswers('setTimeout(() => { window.answers = window.showBoxes() }); true')
    // Once stopped, the page's next boxes are answered Cancel without showing.
    await expect.poll(() => pageAnswers('window.answers ?? null').catch(() => null)).toEqual([true, true, false, false])
    expect(await electronApp.evaluate(() => (globalThis as BoxesGlobal).__pageBoxes)).toEqual([
      { message: 'Box 0', checkboxLabel: '' },
      { message: 'Box 1', checkboxLabel: 'Prevent this page from creating additional dialogs' }
    ])
  } finally {
    await closeFixtureServer(server)
  }
})
