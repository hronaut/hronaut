import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

// Find opened with its last text, where Chrome's opens with the text selected in the page, of at most 250 characters,
// and finds that text there.

const PAGES: Record<string, string> = {
  '/page': '<!doctype html><title>Selections</title><p>alpha needle</p><p>beta haystack</p><p>gamma haystack</p><p>delta haystack</p>'
    + '<p>kettle one</p><textarea>field kettle</textarea><p>kettle two</p><input type="password" value="secret">'
    + '<input type="email" value="spout@example.test">'
    + '<input style="-webkit-text-security: disc" value="masked teapot"><p>teapot</p><pre>two\nlines</pre><p>two lines</p>',
  '/framed': '<!doctype html><title>Framed</title><p>kettle one</p><iframe srcdoc="<p>kettle two</p><p>kettle three</p>"></iframe>'
    + '<p>kettle four</p>'
}

test('Find opens with the text selected in the page and finds it there, but never a password field\'s, as in Chrome', async ({
  capabilities, appWindow, electronApp
}) => {
  const { tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(PAGES[request.url ?? ''] ?? '')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  try {
    type State = { tabs: Array<{ id: string, url: string, loading: boolean }> }
    const tab = async () => ((await appWindow.evaluate(`window.hronaut.getState()`)) as State).tabs.find(candidate => candidate.id === tabId)!
    let url = ''
    const open = async (path: string) => {
      url = `http://127.0.0.1:${address.port}${path}`
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(url)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(async () => { const current = await tab(); return !current.loading && current.url }).toBe(url)
    }
    const inPage = (script: string) => electronApp.evaluate(({ webContents }, { url, script }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('Page web contents was not found')
      return page.executeJavaScript(script)
    }, { url, script })
    await open('/page')
    const bar = appWindow.getByRole('search', { name: 'Find in page' })
    const search = bar.getByRole('searchbox', { name: 'Find text' })
    const count = bar.locator('.find-count')
    const openFind = () => appWindow.getByRole('button', { name: 'Find in page', exact: true }).click()

    await openFind()
    await search.fill('needle')
    await expect(count).toHaveText('1 / 1')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    const selectWord = (paragraph: number, word: string) => inPage(`(() => {
      document.activeElement.blur()
      const text = document.querySelectorAll('p')[${paragraph}].firstChild
      const range = document.createRange()
      range.setStart(text, text.data.indexOf(${JSON.stringify(word)}))
      range.setEnd(text, text.data.indexOf(${JSON.stringify(word)}) + ${word.length})
      getSelection().removeAllRanges()
      getSelection().addRange(range)
    })()`)
    const selectHaystack = (paragraph: number) => selectWord(paragraph, 'haystack')

    // The second "haystack", selected, is the match Find opens on.
    await selectHaystack(2)
    await openFind()
    await expect(search).toHaveValue('haystack')
    await expect(count).toHaveText('2 / 3')
    expect(await search.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd])).toEqual([0, 'haystack'.length])

    // With nothing typed in it, Find open takes up the page's selection again, even the text it searches already.
    await selectHaystack(1)
    await openFind()
    await expect(count).toHaveText('1 / 3')
    await selectHaystack(3)
    await openFind()
    await expect(count).toHaveText('3 / 3')
    await expect(search).toHaveValue('haystack')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    // Text selected in a text field in the page, between the page's other matches.
    await inPage('(() => { const field = document.querySelector("textarea"); field.focus(); field.setSelectionRange(6, 12) })()')
    await openFind()
    await expect(search).toHaveValue('kettle')
    await expect(count).toHaveText('2 / 3')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    // And Find open on the same text takes up text selected in the text field, which it then finds.
    await selectWord(4, 'kettle')
    await openFind()
    await expect(count).toHaveText('1 / 3')
    await inPage('(() => { const field = document.querySelector("textarea"); field.focus(); field.setSelectionRange(6, 12) })()')
    await openFind()
    await expect(count).toHaveText('2 / 3')
    await expect(search).toHaveValue('kettle')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    // The text of a password field, or of a field showing its text masked, stays out of Find, which opens with its last
    // text.
    await inPage('(() => { const field = document.querySelector("input[type=password]"); field.focus(); field.select() })()')
    await openFind()
    await expect(count).toHaveText(/ \/ 3$/)
    await expect(search).toHaveValue('kettle')
    await search.press('Escape')
    await expect(bar).toBeHidden()
    await inPage('(() => { const field = document.querySelector("input:not([type])"); field.focus(); field.setSelectionRange(7, 13) })()')
    await openFind()
    await expect(count).toHaveText(/ \/ 3$/)
    await expect(search).toHaveValue('kettle')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    // Nor does a selection over more than one line, which the Find field, holding one line, could not find.
    await inPage('(() => { document.activeElement.blur(); getSelection().selectAllChildren(document.querySelector("pre")) })()')
    await openFind()
    await expect(count).toHaveText(/ \/ 3$/)
    await expect(search).toHaveValue('kettle')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    // A field without a selection range of its own, such as an email field.
    await inPage('(() => { const field = document.querySelector("input[type=email]"); field.focus(); field.select() })()')
    await openFind()
    await expect(search).toHaveValue('spout@example.test')
    await expect(count).toHaveText('1 / 1')
    await search.press('Escape')
    await expect(bar).toBeHidden()

    // Find closed on a match in a frame within the page, which the frame keeps selected, opens again on that match.
    await open('/framed')
    await openFind()
    await search.fill('kettle')
    await expect(count).toHaveText('1 / 4')
    await search.press('Enter')
    await expect(count).toHaveText('2 / 4')
    await search.press('Enter')
    await expect(count).toHaveText('3 / 4')
    await search.press('Escape')
    await expect(bar).toBeHidden()
    await openFind()
    await expect(search).toHaveValue('kettle')
    await expect(count).toHaveText('3 / 4')
  } finally {
    await closeFixtureServer(server)
  }
})
