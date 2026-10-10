import { expect, test } from './fixtures.js'

type HomeCopyProbe = typeof globalThis & {
  homeCopyProbe?: { calls: number; release(): void; restore(): void }
}

for (const firstSucceeds of [true, false]) {
  test(`clears prior Home copy feedback before another write (previous success: ${firstSucceeds})`, async ({ electronApp, mcpPort }) => {
    await expect.poll(() => electronApp.evaluate(({ webContents }) =>
      webContents.getAllWebContents().some(page => page.getURL().startsWith('hronaut://home'))
    )).toBe(true)
    await electronApp.evaluate(({ clipboard }, succeeds) => {
      const original = clipboard.writeText
      let release!: () => void
      const pending = new Promise<void>(resolve => { release = resolve })
      const probe = { calls: 0, release, restore: () => { clipboard.writeText = original; release() } }
      ;(globalThis as HomeCopyProbe).homeCopyProbe = probe
      clipboard.writeText = async (...args) => {
        probe.calls += 1
        if (probe.calls === 1 && !succeeds) throw new Error('Synthetic Home clipboard failure')
        if (probe.calls === 2) await pending
        await original.apply(clipboard, args)
      }
    }, firstSucceeds)
    const label = () => electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Home fixture not found')
      return home.executeJavaScript(`document.querySelector('[data-copy-target="endpoint"]').textContent`)
    })
    const copy = () => electronApp.evaluate(async ({ webContents }) => {
      const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))
      if (!home) throw new Error('Home fixture not found')
      return home.executeJavaScript(`(() => {
        const button = document.querySelector('[data-copy-target="endpoint"]');
        button.click();
        return button.textContent;
      })()`)
    })
    try {
      await copy()
      await expect.poll(label).toBe(firstSucceeds ? 'Copied' : 'Copy failed')
      expect(await copy()).toBe('Copy URL')
      await expect.poll(() => electronApp.evaluate(() => (globalThis as HomeCopyProbe).homeCopyProbe?.calls)).toBe(2)
      await electronApp.evaluate(() => { (globalThis as HomeCopyProbe).homeCopyProbe?.release() })
      await expect.poll(label).toBe('Copied')
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`http://127.0.0.1:${mcpPort}/mcp`)
    } finally {
      await electronApp.evaluate(() => {
        (globalThis as HomeCopyProbe).homeCopyProbe?.restore()
        delete (globalThis as HomeCopyProbe).homeCopyProbe
      })
    }
  })
}
