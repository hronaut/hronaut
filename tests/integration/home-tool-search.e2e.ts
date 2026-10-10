import { expect, test } from './fixtures.js'

test('searches Home tool-reference words across tool metadata without losing retained expansion', async ({ electronApp }) => {
  await expect.poll(() => electronApp.evaluate(({ webContents }) =>
    webContents.getAllWebContents().some(page => page.getURL().startsWith('hronaut://home'))
  )).toBe(true)
  const read = (query: string | null) => electronApp.evaluate(async ({ webContents }, query) => {
    const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Home fixture not found')
    return home.executeJavaScript(`(() => {
      const query = ${JSON.stringify(query)};
      const search = document.querySelector('#tool-search');
      if (query !== null) {
        document.querySelector('[data-home-view="tools"]').click();
        search.focus(); search.value = query;
        search.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return {
        names: Array.from(document.querySelectorAll('#tool-grid .tool'), node => node.dataset.tool),
        query: search.value, focused: document.activeElement === search,
        noResults: !document.querySelector('#tool-empty').hidden,
        expanded: document.querySelector('[data-tool="browser_network_request"]')?.open ?? false
      };
    })()`)
  }, query)
  await expect.poll(async () => (await read(null)).names.length).toBeGreaterThan(0)
  const initial = await read(null)
  expect(initial.names).toContain('browser_network_request')
  expect(await read('response browser_network_request')).toMatchObject({
    names: ['browser_network_request'], query: 'response browser_network_request', focused: true, noResults: false
  })
  await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Home fixture not found')
    await home.executeJavaScript(`document.querySelector('[data-tool="browser_network_request"] summary').click()`)
  })
  expect(await read('BROWSER_NETWORK_REQUEST   RESPONSE')).toMatchObject({
    names: ['browser_network_request'], focused: true, noResults: false, expanded: true
  })
  expect(await read('   ')).toMatchObject({ names: initial.names, focused: true, noResults: false, expanded: true })
  expect(await read('browser_network_request nonexistent-tool-term')).toMatchObject({ names: [], noResults: true })
})
