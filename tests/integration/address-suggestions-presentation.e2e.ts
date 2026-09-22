import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

for (const scale of [1, 1.25]) {
  test(`presents restored history during rail collapse with native focus at ${scale} scale`, async ({ profileDirectory, mcpPort }, testInfo) => {
    await writeFile(join(profileDirectory, 'settings.json'), JSON.stringify({ tabPosition: 'left', interfaceScale: scale }))
    await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({ version: 1, entries: [{
      id: 'google-visit', url: 'https://www.google.com/', title: 'Google',
      visitedAt: new Date().toISOString(), visitCount: 3
    }] }))
    const { app, window } = await launchHronaut(profileDirectory, mcpPort, scale)
    try {
      await window.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Suggestion background</title><main>Page behind the suggestions</main>', active: true })")
      const session = await window.context().newCDPSession(window)
      await session.send('Emulation.setFocusEmulationEnabled', { enabled: false })
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.focus())
      await window.getByRole('button', { name: 'Collapse tab rail when not in use', exact: true }).click()
      const address = window.getByRole('combobox', { name: 'Address', exact: true })
      await address.hover()
      await address.fill('')
      await address.pressSequentially('google', { delay: 70 })
      await expect(address).toHaveAttribute('aria-expanded', 'true')
      await expect(window.locator('.topbar')).toHaveCSS('width', '56px')
      await expect.poll(() => app.evaluate(async ({ BrowserWindow, webContents }) => {
        const main = BrowserWindow.getAllWindows()[0]!
        const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))
        const children = main.contentView.children
        const index = children.findIndex(child => (child as unknown as { webContents?: { id: number } }).webContents?.id === contents?.id)
        const view = children[index]
        return { visible: view?.getVisible(), topmost: index === children.length - 1, height: view?.getBounds().height, scale: contents?.getZoomFactor() }
      })).toMatchObject({ visible: true, topmost: true, height: expect.any(Number), scale })
      await expect(address).toBeFocused()
      const capture = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
      await writeFile(testInfo.outputPath('native-suggestions.png'), Buffer.from(capture, 'base64'))
      if (process.env.HRONAUT_COMPOSITOR_CAPTURE === 'weston') {
        const result = await promisify(execFile)('weston-screenshooter', [], { cwd: testInfo.outputDir, timeout: 10_000 })
        console.log(result.stdout, result.stderr)
      }
      if (process.env.HRONAUT_COMPOSITOR_CAPTURE === 'x11') {
        await promisify(execFile)('python3', ['-c',
          'import os,sys; from PIL import ImageGrab; ImageGrab.grab(xdisplay=os.environ["DISPLAY"]).save(sys.argv[1])',
          testInfo.outputPath('compositor-suggestions.png')], { timeout: 10_000 })
      }
    } finally {
      await closeHronaut(app)
    }
  })
}
