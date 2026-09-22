import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

// Preserve DOM/call evidence without recording frames during intentional SIGKILL.
test.use({ trace: { mode: process.env.CI ? 'retain-on-failure' : 'off', screenshots: false } })

for (const hidden of [false, true]) {
  test(`reopens suggestions after their ${hidden ? 'hidden' : 'visible'} renderer exits`, async ({ profileDirectory, mcpPort }) => {
    await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({ version: 1, entries: [{
      id: 'google-recovery', url: 'https://www.google.com/', title: 'Google',
      visitedAt: new Date().toISOString(), visitCount: 1
    }] }))
    const { app, window } = await launchHronaut(profileDirectory, mcpPort)
    try {
      await window.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Recovery background</title><main>Page stays open</main>', active: true })")
      const address = window.getByRole('combobox', { name: 'Address', exact: true })
      const overlayState = () => app.evaluate(({ BrowserWindow, webContents }) => {
        const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))
        const main = BrowserWindow.getAllWindows()[0]!
        const view = main.contentView.children.find(child => (child as unknown as { webContents?: { id: number } }).webContents?.id === contents?.id)
        return { id: contents?.id, crashed: contents?.isCrashed(), visible: view?.getVisible() ?? false }
      })
      await address.fill('google')
      await expect.poll(overlayState).toMatchObject({ visible: true, crashed: false })
      const firstId = (await overlayState()).id!
      if (hidden) {
        await address.press('Escape')
        await expect.poll(overlayState).toMatchObject({ visible: false })
      }
      const draftBeforeExit = await address.inputValue()
      await app.evaluate(async ({ BrowserWindow, webContents }, contentsId) => {
        const contents = webContents.fromId(contentsId)
        if (!contents) throw new Error('Suggestion renderer is unavailable')
        const rendererPid = contents.getOSProcessId()
        const mainPid = BrowserWindow.getAllWindows()[0]!.webContents.getOSProcessId()
        if (rendererPid <= 0 || rendererPid === mainPid) throw new Error('Suggestion renderer must be isolated from the shell')
        const exited = new Promise<void>(resolve => contents.once('render-process-gone', () => resolve()))
        process.kill(rendererPid, 'SIGKILL')
        await exited
      }, firstId)
      await expect(address).toHaveAttribute('aria-expanded', 'false')
      await expect(address).toHaveValue(draftBeforeExit)
      await expect.poll(overlayState).toMatchObject({ visible: false })
      await address.fill('goog')
      await address.pressSequentially('le')
      await expect(address).toHaveValue('google')
      await expect(address).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(overlayState).toMatchObject({ visible: true, crashed: false })
      expect((await overlayState()).id).not.toBe(firstId)
      await expect(address).toBeFocused()
      await expect(window.getByRole('tab', { name: /^Recovery background/ })).toBeVisible()
    } finally {
      await closeHronaut(app)
    }
  })
}
