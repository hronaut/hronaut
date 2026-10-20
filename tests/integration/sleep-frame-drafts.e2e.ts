import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

/**
 * Where the draft is: the path of the page that holds it, how to reach its field from the page's frames,
 * and whether the draft is typed. Key events sent to the page did not reach the field of a frame from another
 * site in Docker runs, so that case sets the value instead; a form field counts as changed when its value
 * differs from its default, however the value got there.
 */
const drafts = [
  { name: 'a form in an embedded page from another site', path: '/embedded-form', frame: 'form', field: "document.querySelector('#draft')", typed: false },
  { name: 'an editor in an embedded page', path: '/embedded-editor', frame: 'editor', field: "document.querySelector('#draft')", typed: true },
  { name: 'a field inside a web component', path: '/component-form', frame: undefined, field: "document.querySelector('#host').shadowRoot.querySelector('#draft')", typed: true },
  { name: 'an editor inside a web component', path: '/component-editor', frame: undefined, field: "document.querySelector('#host').shadowRoot.querySelector('#draft')", typed: true }
] as const

/** Serves the pages: each draft's page, the pages it embeds, and a page that embeds one from another site. */
function draftPages() {
  const server = createServer((request, response) => {
    const port = (server.address() as AddressInfo).port
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url === '/embedded-form') response.end(`<!doctype html><title>Draft page</title><iframe name="form" src="http://localhost:${port}/form"></iframe>`)
    else if (request.url === '/form') response.end('<!doctype html><title>Form</title><textarea id="draft"></textarea>')
    else if (request.url === '/embedded-editor') response.end('<!doctype html><title>Draft page</title><iframe name="editor" src="/editor"></iframe>')
    else if (request.url === '/editor') response.end('<!doctype html><title>Editor</title><div id="draft" contenteditable="true"></div>')
    else if (request.url === '/component-editor') response.end(`<!doctype html><title>Draft page</title><div id="host"></div><script>
      document.querySelector('#host').attachShadow({ mode: 'open' }).innerHTML = '<div id="draft" contenteditable="true"></div>'
    </script>`)
    else response.end(`<!doctype html><title>Draft page</title><div id="host"></div><script>
      document.querySelector('#host').attachShadow({ mode: 'open' }).innerHTML = '<textarea id="draft"></textarea>'
    </script>`)
  })
  return server
}

for (const draft of drafts) {
  test(`keeps a tab awake while ${draft.name} holds a draft`, async ({ appWindow, electronApp }) => {
    const server = draftPages()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, () => resolve())
    })
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${draft.path}`
      const tabId = await appWindow.evaluate(async (url) => {
        const hronaut = (window as unknown as { hronaut: HronautApi }).hronaut
        return (await hronaut.newTab({ url, active: true })).activeTabId!
      }, url)
      await expect.poll(() => appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState()
        .then(state => state.tabs.every(tab => !tab.loading)))).toBe(true)

      // Type the draft as a person does, so the page sees real input.
      const read = async (script: string) => electronApp.evaluate(async ({ webContents }, { url, frameName, script }) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
        const frame = frameName ? page.mainFrame.framesInSubtree.find(candidate => candidate.name === frameName)! : page.mainFrame
        return frame.executeJavaScript(script)
      }, { url, frameName: draft.frame, script })
      await expect.poll(() => read(`Boolean(${draft.field})`)).toBe(true)
      if (draft.typed) {
        await electronApp.evaluate(async ({ webContents }, { url, frameName }) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
          page.focus()
          if (frameName) await page.executeJavaScript(`document.querySelector('iframe[name="${frameName}"]').focus()`)
        }, { url, frameName: draft.frame })
        await read(`${draft.field}.focus()`)
        await electronApp.evaluate(({ webContents }, url) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
          for (const character of 'unsent reply') page.sendInputEvent({ type: 'char', keyCode: character })
        }, url)
      } else {
        await read(`${draft.field}.value = 'unsent reply'`)
      }
      await expect.poll(() => read(`${draft.field}.value ?? ${draft.field}.textContent`)).toBe('unsent reply')

      const sleepError = await appWindow.evaluate(async (tabId) => {
        const hronaut = (window as unknown as { hronaut: HronautApi }).hronaut
        await hronaut.newTab({ url: 'about:blank', active: true })
        try {
          await hronaut.setTabSleeping(tabId, true)
          return null
        } catch (error) {
          return error instanceof Error ? error.message : String(error)
        }
      }, tabId)

      // The draft used to be thrown away: only the page's own fields were checked.
      expect(sleepError).toContain('partially filled form')
      expect(await read(`${draft.field}.value ?? ${draft.field}.textContent`)).toBe('unsent reply')
    } finally {
      await closeFixtureServer(server)
    }
  })
}
