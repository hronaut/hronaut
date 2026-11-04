import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

// In Chrome, Up, Down, Page Up and Page Down in the find bar's field, and Home and End with Ctrl, scroll the page, even
// with a text field focused in the page, which is unfocused first. In Hronaut's Find field they did nothing.

test('the keys that scroll the page work from the Find field, as in Chrome, and leave a field in the page alone', async ({
  capabilities, appWindow, electronApp
}) => {
  const { tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Long page</title><textarea>first line\nsecond line</textarea><p>needle</p><div style="height: 6000px"></div><p>end</p>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/long`
  try {
    type State = { tabs: Array<{ id: string, url: string, loading: boolean }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(url)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(url)
    const inPage = <T>(script: string) => electronApp.evaluate(({ webContents }, { url, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript(script)
    }, { url, script }) as Promise<T>
    const scrollTop = () => inPage<number>('Math.round(scrollY)')

    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    await search.fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 1')
    // A text field focused in the page, its caret after "first", after the search, as a search that finds a match leaves
    // nothing in the page focused.
    await inPage('(() => { const field = document.querySelector("textarea"); field.focus(); field.setSelectionRange(5, 5) })()')
    // With Find open, which leaves the page less room.
    const bottom = await inPage<number>('Math.round(document.documentElement.scrollHeight - innerHeight)')
    // Where each key's scroll ended. In Chromium, a scroll key pressed while the page still scrolls for the key before can
    // end without scrolling, as the earlier scroll's end ends its scroll too, so each key waits for the one before.
    await inPage('(() => { window.qaScrollEnds = 0; addEventListener("scrollend", () => { qaScrollEnds += 1 }) })()')
    const scrollWith = async (key: string) => {
      const ended = await inPage<number>('qaScrollEnds')
      await search.press(key)
      await expect.poll(() => inPage<number>('qaScrollEnds')).toBeGreaterThan(ended)
      return scrollTop()
    }

    expect(await scrollWith('PageDown')).toBeGreaterThan(0)
    // The page unfocused its field, which kept its text and caret, and the keyboard stayed in Find.
    expect(await inPage('[document.activeElement.tagName, document.querySelector("textarea").value, document.querySelector("textarea").selectionStart]'))
      .toEqual(['BODY', 'first line\nsecond line', 5])
    await expect(search).toBeFocused()
    await expect(search).toHaveValue('needle')

    expect(await scrollWith('Control+End')).toBe(bottom)
    expect(await scrollWith('PageUp')).toBeLessThan(bottom)
    expect(await scrollWith('Control+Home')).toBe(0)
    const arrowed = await scrollWith('ArrowDown')
    expect(arrowed).toBeGreaterThan(0)
    expect(await scrollWith('ArrowUp')).toBeLessThan(arrowed)

    // Home and End without Ctrl stay with the field, as in Chrome.
    expect(await scrollWith('Control+End')).toBe(bottom)
    await search.press('Home')
    await expect.poll(() => search.evaluate((field: HTMLInputElement) => field.selectionStart)).toBe(0)
    expect(await scrollTop()).toBe(bottom)
    await expect(bar.locator('.find-count')).toHaveText('1 / 1')
  } finally {
    await closeFixtureServer(server)
  }
})

test('the keys that scroll the page from the Find field scroll the frame within it that has the focus, as in Chrome', async ({
  capabilities, appWindow, electronApp
}) => {
  const { tabId } = capabilities
  const frame = '<textarea>first line</textarea><div style=&quot;height: 6000px&quot;></div>'
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Framed page</title><p>needle</p><iframe srcdoc="${frame}" style="height: 300px"></iframe>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/framed`
  try {
    type State = { tabs: Array<{ id: string, url: string, loading: boolean }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(url)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(url)
    const inPage = <T>(script: string) => electronApp.evaluate(({ webContents }, { url, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript(script)
    }, { url, script }) as Promise<T>
    const framed = 'document.querySelector("iframe").contentWindow'

    await appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    await search.fill('needle')
    await expect(bar.locator('.find-count')).toHaveText('1 / 1')
    // The text field focused in the frame, its caret after "first".
    await inPage(`(() => { const field = ${framed}.document.querySelector("textarea"); field.focus(); field.setSelectionRange(5, 5) })()`)

    await search.press('PageDown')
    await expect.poll(() => inPage<number>(`Math.round(${framed}.scrollY)`)).toBeGreaterThan(0)
    // The frame unfocused its field, which kept its text and caret, and kept the focus in the page.
    expect(await inPage(`(() => {
      const field = ${framed}.document.querySelector("textarea")
      return [document.activeElement.tagName, ${framed}.document.activeElement.tagName, field.value, field.selectionStart]
    })()`)).toEqual(['IFRAME', 'BODY', 'first line', 5])
    await expect(search).toBeFocused()
  } finally {
    await closeFixtureServer(server)
  }
})
