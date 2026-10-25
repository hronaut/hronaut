import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type State = { activeTabId?: string; tabs: Array<{ id: string; url: string }> }

// The page's context menu had no Copy link to highlight, as Chrome's has. The link it copies opens the page scrolled to
// the selected text, also when the selection cuts a word, keeps preformatted spaces, crosses table cells, a line break
// or an inline block, holds hidden text, leaves out text the page makes unselectable, or is text the page holds more
// than once.

const selectAll = (id: string) => `getSelection().selectAllChildren(document.getElementById(${JSON.stringify(id)}))`
const selectText = (id: string, from: number, to: number) => `{ const text = document.getElementById(${JSON.stringify(id)}).firstChild; getSelection().setBaseAndExtent(text, ${from}, text, ${to}) }`
const CASES = [
  { id: 'target', html: '<p id="target">Run   npm ci --ignore-scripts before the build.</p>', select: selectAll('target'), text: 'Run%20npm%20ci%20%2D%2Dignore%2Dscripts%20before%20the%20build.' },
  { id: 'across', html: '<div id="across"><p>Agents get their own browser.</p><p>Every project keeps its sign-ins apart.</p></div>', select: selectAll('across'), text: 'Agents%20get%20their%20own%20browser.,project%20keeps%20its%20sign%2Dins%20apart.' },
  { id: 'cut', html: '<p id="cut">Highlight the text here</p>', select: selectText('cut', 1, 15), text: 'Highlight%20the%20text' },
  { id: 'pre', html: '<pre id="pre">x   = 1</pre>', select: selectAll('pre'), text: 'x%20%20%20%3D%201' },
  { id: 'cells', html: '<table id="cells"><tr><td>Price</td><td>Total</td></tr></table>', select: selectAll('cells'), text: 'Price,Total' },
  // Cut at both ends, so only the page's text, which a line break splits, gives whole words.
  { id: 'lines', html: '<p id="lines">line one<br>line two</p>', select: '{ const lines = document.getElementById("lines"); getSelection().setBaseAndExtent(lines.firstChild, 1, lines.lastChild, 7) }', text: 'line%20one,line%20two' },
  { id: 'hidden', html: '<p id="hidden">Open <span style="display: none">secret </span>the door</p>', select: selectAll('hidden'), text: 'Open%20the%20door' },
  { id: 'unselectable', html: '<p id="unselectable">Press <kbd style="user-select: none">Ctrl</kbd> K now</p>', select: selectAll('unselectable'), text: 'Press%20Ctrl%20K%20now' },
  { id: 'inline-block', html: '<p id="inline-block">Alpha <span style="display: inline-block">Beta</span> Gamma</p>', select: selectAll('inline-block'), text: 'Alpha,Gamma' },
  { id: 'repeated', html: '<p id="repeated">Then the word apple again.</p>', select: selectText('repeated', 5, 19), text: 'Then-,the%20word%20apple,-again.' }
]

test('Copy link to highlight copies a link that opens the page at the selected text, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    // The same words appear first near the top, so only the words around the later copy find it.
    response.end(`<!doctype html><title>Highlight fixture</title><style>body { font: 24px sans-serif }</style>
      <h1 id="top">Guide</h1><p>Pick the word apple first.</p>
      ${CASES.map(({ html }) => `<div style="height: 3000px"></div>${html}`).join('')}
      <div style="height: 3000px"></div>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const state = async () => await appWindow.evaluate(`window.hronaut.getState()`) as State
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/page#top`)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === tabId)?.url).toBe(`${origin}/page#top`)

    // The person selects text on the page and right-clicks it, then chooses the item.
    const choose = (element: string, select: string) => electronApp.evaluate(async ({ Menu, webContents }, { origin, element, select }) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === `${origin}/page#top`)
      if (!page) throw new Error('Page web contents was not found')
      const point = await page.mainFrame.executeJavaScript(`(() => {
        document.getElementById(${JSON.stringify(element)}).scrollIntoView({ block: 'center' })
        ${select}
        const box = getSelection().getRangeAt(0).getClientRects()[0]
        return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) }
      })()`) as { x: number, y: number }
      const popup = Menu.prototype.popup
      let menu: Electron.Menu | undefined
      Menu.prototype.popup = function (): void { menu = this }
      try {
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
        for (let waited = 0; !menu && waited < 5_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
      } finally {
        Menu.prototype.popup = popup
      }
      const ids = menu?.items.map(item => item.id).filter(Boolean).slice(0, 3)
      const item = menu?.getMenuItemById('copy-link-to-highlight')
      if (!item?.click) throw new Error(`Missing Copy link to highlight in the page's context menu: ${JSON.stringify(ids)}`)
      ;(item.click as unknown as () => void)()
      return { label: item.label, ids }
    }, { origin, element, select })
    const clipboard = () => electronApp.evaluate(({ clipboard }) => clipboard.readText())

    const links: Array<[string, string]> = []
    for (const { id, select, text } of CASES) {
      const chosen = await choose(id, select)
      expect(chosen.label, id).toBe('Copy Link to Highlight')
      if (id === 'target') expect(chosen.ids).toEqual(['copy-selection', 'copy-link-to-highlight', 'search-selection'])
      const link = `${origin}/page#top:~:text=${text}`
      await expect.poll(clipboard, { message: id }).toBe(link)
      links.push([link, id])
    }

    // Each link opens the page with its text in view, not the page's own fragment at the top.
    for (const [opened, element] of links) {
      const shown = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<{ activeTabId?: string }> } }).hronaut.newTab({ url, active: true })).activeTabId, opened)
      await expect.poll(async () => (await state()).tabs.find(tab => tab.id === shown)?.url).toBe(opened)
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, { opened, element }) => {
        const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === opened)
        if (!page || page.isLoading()) return 'loading'
        return await page.mainFrame.executeJavaScript(`(() => {
          const box = document.getElementById(${JSON.stringify(element)}).getBoundingClientRect()
          return box.top >= 0 && box.bottom <= innerHeight ? 'in view' : 'scrollY ' + scrollY
        })()`) as string
      }, { opened, element }), { message: element, timeout: 10_000 }).toBe('in view')
    }
  } finally {
    await closeFixtureServer(server)
  }
})
