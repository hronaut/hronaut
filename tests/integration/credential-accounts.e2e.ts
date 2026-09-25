import { createServer } from 'node:http'
import { credentialCapturePageScript } from '../../src/main/browser/credential-capture-page.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('captures distinct accounts through two-step website logins in Chromium', async ({ electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Multiple accounts</title><main></main>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let contentsId: number | undefined
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture address unavailable')
    const origin = `http://127.0.0.1:${address.port}`
    contentsId = await electronApp.evaluate(async ({ BrowserWindow }, url) => {
      const window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } })
      await window.loadURL(url)
      return window.webContents.id
    }, origin)
    for (const username of ['alice', 'bob']) {
      const result = await electronApp.evaluate(async ({ webContents }, { id, username, script }) => {
        const contents = webContents.fromId(id)!
        await contents.executeJavaScript(`document.querySelector('main').innerHTML = '<input autocomplete="section-login username"><button>Next</button>'`)
        // Observe the promise without blocking the main-process test on a submission.
        await contents.executeJavaScript(`void (window.__capture = ${script})`)
        await contents.executeJavaScript(`(() => {
          const input = document.querySelector('input');
          input.value = ${JSON.stringify(username)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('button').click();
          document.querySelector('main').innerHTML = '<input type="password" autocomplete="current-password" value="synthetic-password"><button>Log in</button>';
          document.querySelector('button').click();
        })()`)
        return contents.executeJavaScript('window.__capture.then(({ origin, username, password }) => ({ origin, username, passwordMatches: password === "synthetic-password" }))')
      }, { id: contentsId, username, script: credentialCapturePageScript() })
      expect(result).toEqual({ origin, username, passwordMatches: true })
    }
  } finally {
    if (contentsId !== undefined) await electronApp.evaluate(({ BrowserWindow, webContents }, id) => {
      const contents = webContents.fromId(id)
      if (contents) BrowserWindow.fromWebContents(contents)?.destroy()
    }, contentsId)
    await closeFixtureServer(server)
  }
})
