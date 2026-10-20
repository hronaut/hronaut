import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Playwright's trace snapshots run scripts in each traced page as if the person had clicked, which would hide what
// Hronaut gives the page.
test.use({ trace: 'off' })

test('loading a page gives neither it nor a page it embeds the activation of a click', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    const port = (server.address() as AddressInfo).port
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url === '/embedded-form') response.end(`<!doctype html><title>Draft page</title><iframe src="http://localhost:${port}/form"></iframe>`)
    else response.end('<!doctype html><title>Form</title><textarea></textarea>')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, () => resolve())
  })
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const frames = (url: string, script: string) => electronApp.evaluate(async ({ webContents }, { url, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) return []
      return Promise.all(page.mainFrame.framesInSubtree.map(frame => frame.executeJavaScript(script)))
    }, { url, script })
    // A page on its own, then a page that embeds a page from another site.
    for (const [path, frameCount] of [['/form', 1], ['/embedded-form', 2]] as const) {
      const url = `${origin}${path}`
      await appWindow.evaluate(async (url) => {
        await (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true })
      }, url)
      // Once Hronaut has started watching every document for edits, none may act as if the person had clicked.
      await expect.poll(() => frames(url, 'window.__hronautFormEditTrackingInstalled === true')).toEqual(Array(frameCount).fill(true))
      // Watching used to run as a click, so the page, and an embedded page from another site, could open windows or
      // move the whole tab elsewhere without the person doing anything.
      expect(await frames(url, 'navigator.userActivation.hasBeenActive')).toEqual(Array(frameCount).fill(false))
    }
  } finally {
    await closeFixtureServer(server)
  }
})
