import { expect, test } from './fixtures.js'

test('temporarily unlocks one page under the global input lock and resets on the next lock cycle', async ({
  appWindow,
  electronApp
}) => {
  const html = '<button id="action" style="width:160px;height:50px">Act</button><script>window.clicks=0;document.querySelector("#action").addEventListener("click",()=>window.clicks++)</script>'
  const url = `data:text/html,${encodeURIComponent(html)}`
  const tabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true })
    .then((state) => state.activeTabId)`) as string
  const otherUrl = 'data:text/html,<title>Other locked page</title>'
  const otherTabId = await appWindow.evaluate(`window.hronaut.newTab({
    url: ${JSON.stringify(otherUrl)}, active: false
  }).then((state) => state.tabs.find((tab) => tab.url === ${JSON.stringify(otherUrl)})?.id)`) as string
  const click = (): Promise<boolean> => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Interaction fixture page missing')
    const point = await page.executeJavaScript(`(() => {
      const bounds = document.querySelector('#action').getBoundingClientRect()
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    })()`)
    // Observe the native guard's decision, then let the caller independently
    // await the renderer click. A main-process tick does not flush page input.
    let observed!: (blocked: boolean) => void
    let timeout: ReturnType<typeof setTimeout> | undefined
    const dispatched = new Promise<boolean>((resolve, reject) => {
      observed = resolve
      timeout = setTimeout(() => reject(new Error('Native mouse input was not observed')), 5000)
    })
    const onMouse = (event: Electron.Event, mouse: Electron.MouseInputEvent): void => {
      if (mouse.type === 'mouseUp') observed(event.defaultPrevented)
    }
    page.on('before-mouse-event', onMouse)
    try {
      page.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point })
      page.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point })
      return await dispatched
    } finally {
      clearTimeout(timeout)
      page.removeListener('before-mouse-event', onMouse)
    }
  }, url)
  const clicks = (): Promise<number> => electronApp.evaluate(async ({ webContents }, requestedUrl) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getURL() === requestedUrl)
    if (!page) throw new Error('Interaction fixture page missing')
    return Number(await page.executeJavaScript('window.clicks'))
  }, url)
  try {
    await appWindow.getByRole('button', { name: /Block human page input/ }).click()
    const unlockTab = appWindow.getByRole('button', { name: 'Unlock page input in this tab' })
    await expect(unlockTab).toBeEnabled()
    expect(await click()).toBe(true)
    expect(await clicks()).toBe(0)

    await unlockTab.click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.humanInteractionInputLocked)`)).toBe(false)
    expect(await appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.find((tab) => tab.id === ${JSON.stringify(otherTabId)})?.humanInteractionInputLocked)`)).toBe(true)
    expect(await click()).toBe(false)
    await expect.poll(clicks).toBe(1)

    await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
    await appWindow.getByRole('button', { name: /Block human page input/ }).click()
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.humanInteractionInputLocked)`)).toBe(true)
    expect(await click()).toBe(true)
    expect(await clicks()).toBe(1)
  } finally {
    await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(false)').catch(() => undefined)
  }
})
