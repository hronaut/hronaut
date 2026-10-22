import { expect, test } from './fixtures.js'

const pages = ['one', 'two', 'three', 'four'].map((name) => `data:text/html,<title>Place ${name}</title>`)

test('reopens a closed tab in its place among the tabs, with Ctrl/Cmd+Shift+T and by its Recently closed entry', async ({ appWindow }) => {
  for (const url of pages) await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: false })`)
  const order = () => appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.map((tab) => tab.url).filter((url) => url.includes('Place')))`)
  const close = async (url: string) => {
    const id = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.tabs.find((tab) => tab.url === ${JSON.stringify(url)}).id)`)
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(id)})`)
  }
  await expect.poll(order).toEqual(pages)

  // Ctrl/Cmd+Shift+T put the tab after the last tab; Chrome puts it back where it was.
  await close(pages[1]!)
  await expect.poll(order).toEqual([pages[0], pages[2], pages[3]])
  await appWindow.keyboard.press('ControlOrMeta+Shift+T')
  await expect.poll(order).toEqual(pages)

  // A tab chosen from Recently closed, not the last one closed, goes back to its place as well, and the last one
  // closed then goes back before the others.
  await close(pages[3]!)
  await close(pages[0]!)
  await expect.poll(order).toEqual([pages[1], pages[2]])
  const last = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.closedTabs.find((tab) => tab.url === ${JSON.stringify(pages[3])}).id)`)
  await appWindow.evaluate(`window.hronaut.reopenClosedTab(${JSON.stringify(last)})`)
  await expect.poll(order).toEqual([pages[1], pages[2], pages[3]])
  await appWindow.keyboard.press('ControlOrMeta+Shift+T')
  await expect.poll(order).toEqual(pages)

  // Reopening by its entry, as Search tabs does, put a middle tab after the last one too.
  await close(pages[2]!)
  const middle = await appWindow.evaluate(`window.hronaut.getState().then((state) => state.closedTabs.find((tab) => tab.url === ${JSON.stringify(pages[2])}).id)`)
  await appWindow.evaluate(`window.hronaut.reopenClosedTab(${JSON.stringify(middle)})`)
  await expect.poll(order).toEqual(pages)
})
