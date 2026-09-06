import { expect, test } from './fixtures.js'

for (const method of ['write', 'read'] as const) {
  test(`reports asynchronous image clipboard ${method} rejection and recovers the queue`, async ({ appWindow, electronApp }) => {
    const state = await appWindow.evaluate("window.hronaut.newTab({url:'data:text/html,<main>Clipboard recovery</main>',active:true})") as { activeTabId: string }
    await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
      const page = webContents.getAllWebContents().find((entry) => entry.getURL().startsWith('data:text/html'))
      return page ? page.executeJavaScript("document.readyState") : null
    })).toBe('complete')
    await electronApp.evaluate(({ clipboard }, operation) => {
      const original = clipboard[operation].bind(clipboard)
      if (operation === 'write') {
        clipboard.write = async (...args) => {
          clipboard.write = original as typeof clipboard.write
          await Promise.resolve()
          throw new Error(`Rejected async clipboard write (${args.length})`)
        }
      } else {
        clipboard.read = async () => {
          clipboard.read = original as typeof clipboard.read
          await Promise.resolve()
          throw new Error('Rejected async clipboard read')
        }
      }
    }, method)
    await expect(appWindow.evaluate(`window.hronaut.capturePage({tabId:${JSON.stringify(state.activeTabId)}})`))
      .rejects.toThrow(`Rejected async clipboard ${method}`)
    await appWindow.evaluate("window.hronaut.copyText('queue recovered')")
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('queue recovered')
    await appWindow.evaluate(`window.hronaut.capturePage({tabId:${JSON.stringify(state.activeTabId)}})`)
    expect(await electronApp.evaluate(async ({ clipboard }) => {
      const item = (await clipboard.read()).find((entry) => entry.types.includes('image/png'))
      if (!item) return 0
      const blob = await item.getType('image/png')
      return blob instanceof Blob ? blob.size : 0
    })).toBeGreaterThan(0)
  })
}

test('serializes a second copy behind an unfinished asynchronous clipboard write', async ({ appWindow, electronApp }) => {
  await electronApp.evaluate(({ clipboard }) => {
    const original = clipboard.writeText.bind(clipboard)
    const state = globalThis as typeof globalThis & { __clipboardCalls?: string[]; __finishClipboardWrite?: () => void }
    state.__clipboardCalls = []
    const gate = new Promise<void>((resolve) => { state.__finishClipboardWrite = resolve })
    clipboard.writeText = async (value) => {
      state.__clipboardCalls!.push(value)
      if (value === 'first copy') await gate
      await original(value)
    }
  })
  const copies = appWindow.evaluate("Promise.all([window.hronaut.copyText('first copy'), window.hronaut.copyText('second copy')])")
  try {
    await expect.poll(() => electronApp.evaluate(() => (
      (globalThis as typeof globalThis & { __clipboardCalls?: string[] }).__clipboardCalls
    ))).toEqual(['first copy'])
  } finally {
    await electronApp.evaluate(() => {
      const state = globalThis as typeof globalThis & { __finishClipboardWrite?: () => void }
      state.__finishClipboardWrite?.()
      delete state.__finishClipboardWrite
    })
  }
  await copies
  expect(await electronApp.evaluate(() => (
    (globalThis as typeof globalThis & { __clipboardCalls?: string[] }).__clipboardCalls
  ))).toEqual(['first copy', 'second copy'])
  expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('second copy')
})
