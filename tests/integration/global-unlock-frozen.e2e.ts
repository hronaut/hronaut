import { test, expect } from './fixtures.js'

test('global unlock settles without thawing a frozen page or leaving its toolbar spinner pending', async ({ appWindow, electronApp }) => {
  const url = 'data:text/html,' + encodeURIComponent('<title>Frozen unlock fixture</title><button>Action</button>')
  const tabId = await appWindow.evaluate(`window.hronaut.newTab({url:${JSON.stringify(url)},active:true}).then(state=>state.activeTabId)`) as string
  await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state=>state.tabs.find(tab=>tab.active)?.title)')).toBe('Frozen unlock fixture')
  await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(true)')
  await appWindow.evaluate(`window.hronaut.setTabPageLifecycle(${JSON.stringify(tabId)},'frozen')`)
  try {
    await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
    await expect(appWindow.getByRole('button', { name: /Waiting.*Allow human page input/ })).toHaveCount(0, { timeout: 5000 })
    const state = await appWindow.evaluate('window.hronaut.getState()')
    expect(state.allHumanInteractionLocked).toBe(true)
    expect(state.tabs.find((tab: { id: string }) => tab.id === tabId).pageLifecycleState).toBe('frozen')
    await expect(appWindow.getByText('Resume frozen or unresolved pages before changing page input locks.', { exact: false })).toBeVisible()
  } finally {
    // Release Chromium directly even on the old implementation, where its
    // queued Runtime.evaluate prevents the ordinary resume command from running.
    await electronApp.evaluate(async ({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(page=>page.getURL() === url)
      await page?.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' })
    }, url)
  }
  await appWindow.evaluate(`window.hronaut.setTabPageLifecycle(${JSON.stringify(tabId)},'active')`)
  await appWindow.getByRole('button', { name: /Allow human page input/ }).click()
  await expect.poll(()=>appWindow.evaluate('window.hronaut.getState().then(state=>state.allHumanInteractionLocked)')).toBe(false)
  await expect(appWindow.getByRole('button', { name: /Block human page input/ })).toBeEnabled()
})
