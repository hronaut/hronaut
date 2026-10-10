import { expect, test } from './fixtures.js'

type ClipboardProbe = typeof globalThis & {
  endpointCopyProbe?: { calls: number; release(success: boolean): void; restore(): void }
}

for (const succeeded of [true, false]) {
  test(`clears prior MCP endpoint copy feedback during another write (success: ${succeeded})`, async ({ appWindow, electronApp, mcpPort }) => {
    await electronApp.evaluate(({ clipboard }) => {
      const original = clipboard.writeText
      let release!: (success: boolean) => void
      const pending = new Promise<boolean>(resolve => { release = resolve })
      const probe = { calls: 0, release, restore: () => { clipboard.writeText = original; release(true) } }
      ;(globalThis as ClipboardProbe).endpointCopyProbe = probe
      clipboard.writeText = async (...args) => {
        probe.calls += 1
        if (probe.calls === 2 && !await pending) throw new Error('Synthetic endpoint clipboard failure')
        await original.apply(clipboard, args)
      }
    })
    try {
      await appWindow.getByRole('button', { name: 'MCP ready', exact: true }).click()
      const summary = appWindow.locator('.mcp-readiness-summary')
      await summary.getByRole('button', { name: 'Copy URL', exact: true }).click()
      await expect(summary.getByRole('button', { name: 'MCP URL copied', exact: true })).toBeVisible()
      expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(`http://127.0.0.1:${mcpPort}/mcp`)
      await summary.getByRole('button', { name: 'MCP URL copied', exact: true }).click()
      await expect.poll(() => electronApp.evaluate(() => (globalThis as ClipboardProbe).endpointCopyProbe?.calls)).toBe(2)
      expect(await summary.getByRole('button').innerText()).toBe('Copy URL')
      await electronApp.evaluate((_, success) => { (globalThis as ClipboardProbe).endpointCopyProbe?.release(success) }, succeeded)
      if (!succeeded) await expect(appWindow.getByText('Copy failed', { exact: true })).toBeVisible()
      await expect(summary.getByRole('button', { name: succeeded ? 'MCP URL copied' : 'Copy URL', exact: true })).toBeVisible()
      if (!succeeded) {
        await summary.getByRole('button', { name: 'Copy URL', exact: true }).click()
        await expect(summary.getByRole('button', { name: 'MCP URL copied', exact: true })).toBeVisible()
      }
      await expect(appWindow.getByRole('button', { name: 'Pause agents', exact: true })).toBeEnabled()
    } finally {
      await electronApp.evaluate(() => {
        (globalThis as ClipboardProbe).endpointCopyProbe?.restore()
        delete (globalThis as ClipboardProbe).endpointCopyProbe
      })
    }
  })
}
