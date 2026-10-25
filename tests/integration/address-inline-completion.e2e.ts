import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { HronautApi } from '../../src/shared/types.js'

type TestWindow = Window & { hronaut: HronautApi }

// The address bar left what was typed as it was, so a visited site's name and Enter searched for it. Chrome fills in
// the rest of the site after the typed text, selected, and Enter opens it. The keys are real key presses.
test('fills in the rest of a visited site as it is typed, as in Chrome, and Backspace or the arrows leave the typed text', async ({ appWindow }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Inline ${request.url}</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, 'localhost', resolve))
  const port = server.address()
  if (!port || typeof port === 'string') throw new Error('Missing fixture port')
  const site = `localhost:${port.port}`
  try {
    const state = () => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState())
    // Two visits, as a site needs to be filled in.
    for (let visit = 0; visit < 2; visit += 1) {
      const visited = await appWindow.evaluate(async url => (await (window as unknown as TestWindow).hronaut.newTab({ url, active: true })).activeTabId!, `http://${site}/app/settings`)
      await expect.poll(async () => (await state()).tabs.find(tab => tab.id === visited)?.title).toBe('Inline /app/settings')
    }
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    const field = () => address.evaluate((input: HTMLInputElement) => ({
      value: input.value,
      selected: input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0)
    }))
    const blankTab = async () => {
      const id = await appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronaut.newTab({ active: true })).activeTabId!)
      await address.click()
      await expect(address).toHaveValue('')
      return id
    }

    // The rest of the site's host, selected after the typed text; Enter opens the site.
    const first = await blankTab()
    await address.pressSequentially('localh')
    await expect.poll(field).toEqual({ value: site, selected: site.slice('localh'.length) })
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    // Ctrl+Z steps back a character, as it looked then, and typing it again fills in the rest again.
    await address.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
    await expect.poll(field).toEqual({ value: site, selected: site.slice('local'.length) })
    await address.pressSequentially('h')
    await expect.poll(field).toEqual({ value: site, selected: site.slice('localh'.length) })
    await address.press('Enter')
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === first)?.url).toBe(`http://${site}/`)

    // Once the typed text reaches a path, the rest of the page; Backspace takes the rest away, and Enter opens what was
    // typed.
    const second = await blankTab()
    await address.pressSequentially(`${site}/a`)
    await expect.poll(field).toEqual({ value: `${site}/app/settings`, selected: 'pp/settings' })
    await address.press('Backspace')
    await expect.poll(field).toEqual({ value: `${site}/a`, selected: '' })
    await address.press('Enter')
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === second)?.url).toBe(`http://${site}/a`)

    // Typing on over the rest keeps filling it in, and moving the highlight goes back to the typed text.
    await blankTab()
    await address.pressSequentially('loc')
    await expect.poll(field).toEqual({ value: site, selected: site.slice(3) })
    await address.pressSequentially('al')
    await expect.poll(field).toEqual({ value: site, selected: site.slice(5) })
    await address.press('ArrowDown')
    await expect.poll(field).toEqual({ value: 'local', selected: '' })
    await expect(address).toHaveAttribute('aria-activedescendant', /^address-suggestion-history:/u)
  } finally {
    await closeFixtureServer(server)
  }
})
