import { writeFile } from 'node:fs/promises'
import { expect, test } from './fixtures.js'

for (const scale of [1, 1.25]) {
  test(`animates collapse with native page bounds and clean reversals at ${scale} scale`, async ({ appWindow, electronApp }, testInfo) => {
    await appWindow.emulateMedia({ reducedMotion: 'no-preference' })
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1400, 800))
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
    await appWindow.evaluate("window.hronautSettings.setTheme('cyberpunk-turbo')")
    await appWindow.evaluate("window.hronautSettings.setTabPosition('left')")
    await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Rail motion fixture</title><h1>Page beside moving panel</h1>', active: true })")
    const rail = appWindow.locator('.topbar')
    const home = appWindow.locator('.app-home-button')
    const address = appWindow.locator('input.address')
    await appWindow.locator('.tab-rail-pin').click()
    await home.focus()
    await appWindow.mouse.move(700, 400)
    await expect(rail).toHaveCSS('width', '280px')
    await electronApp.evaluate(({ BrowserWindow, ipcMain }) => {
      const window = BrowserWindow.getAllWindows()[0]!
      const view = window.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Rail motion fixture')!
      const samples: Array<{ inset: number; nativeX: number; visualWidth: number }> = []
      let capture: Promise<string> | undefined
      const pending: Promise<void>[] = []
      const listener = (_event: Electron.IpcMainEvent, insets: { left: number }): void => {
        const nativeX = view.getBounds().x
        const record = { inset: insets.left, nativeX, visualWidth: 0 }
        samples.push(record)
        pending.push(window.webContents.executeJavaScript('document.querySelector(".topbar").getBoundingClientRect().width').then((width: number) => { record.visualWidth = width }))
        if (!capture && insets.left > 60 && insets.left < 260) capture = window.capturePage().then(image => image.toPNG().toString('base64'))
      }
      ipcMain.on('browser:content-insets', listener)
      Object.assign(globalThis, { __railMotion: { samples, pending, listener, image: () => capture } })
    })
    try {
      const frames = await appWindow.evaluate(async () => {
        const rail = document.querySelector<HTMLElement>('.topbar')!
        const frames: Array<{ width: number; collapsing: boolean; tabsInert: boolean; actionsInert: boolean }> = []
        document.querySelector<HTMLInputElement>('input.address')!.focus()
        await new Promise<void>(resolve => {
          const sample = (): void => {
            frames.push({ width: rail.getBoundingClientRect().width, collapsing: rail.classList.contains('rail-collapsing'),
              tabsInert: rail.querySelector<HTMLElement>('.browser-tabs-bar')!.inert,
              actionsInert: rail.querySelector<HTMLElement>('.topbar-actions')!.inert })
            if (frames.at(-1)!.width <= 56.1 && !frames.at(-1)!.collapsing) resolve()
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        return frames
      })
      expect(frames.some(frame => frame.collapsing && frame.width > 56 && frame.width < 280)).toBe(true)
      expect(frames.filter(frame => frame.collapsing).every(frame => frame.tabsInert && frame.actionsInert)).toBe(true)
      expect(frames.at(-1)).toMatchObject({ collapsing: false, tabsInert: false, actionsInert: false })
      await expect(rail).toHaveCSS('width', '56px')
      const native = await electronApp.evaluate(async () => {
        const result = (globalThis as typeof globalThis & { __railMotion: { samples: Array<{ inset: number; nativeX: number; visualWidth: number }>; pending: Promise<void>[]; image: () => Promise<string> | undefined } }).__railMotion
        await Promise.all(result.pending)
        return { samples: result.samples, image: await result.image() }
      })
      expect(native.samples.some(sample => sample.inset > 56 && sample.inset < 280)).toBe(true)
      for (const sample of native.samples) {
        expect(sample.nativeX).toBe(Math.ceil(sample.inset * scale))
        expect(sample.visualWidth).toBeGreaterThan(0)
        expect(sample.nativeX + 1).toBeGreaterThanOrEqual(sample.visualWidth * scale)
      }
      await writeFile(testInfo.outputPath(`collapse-frames-${scale}.json`), JSON.stringify({ frames, native: native.samples }, null, 2))
      expect(native.image).toBeTruthy()
      await writeFile(testInfo.outputPath(`collapse-middle-${scale}.png`), Buffer.from(native.image!, 'base64'))
      await rail.screenshot({ path: testInfo.outputPath(`collapse-final-${scale}.png`) })
    } finally {
      await electronApp.evaluate(({ ipcMain }) => {
        const state = globalThis as typeof globalThis & { __railMotion?: { listener: (event: Electron.IpcMainEvent, insets: { left: number }) => void } }
        if (state.__railMotion) ipcMain.removeListener('browser:content-insets', state.__railMotion.listener)
        delete state.__railMotion
      })
    }
    // Re-enter during the animation, then focus the reopened controls. No old
    // frame may collapse or disable the newly revealed panel.
    await home.focus()
    await expect(rail).toHaveCSS('width', '280px')
    await address.focus()
    await appWindow.mouse.move(12, 120)
    await home.focus()
    await expect(rail).not.toHaveClass(/rail-collapsing/)
    await expect(home).toBeFocused()
    await expect(rail.locator('.browser-tabs-bar')).not.toHaveAttribute('inert')
    const handle = appWindow.getByRole('separator', { name: 'Resize workspace panel', exact: true })
    await handle.focus()
    await handle.press('ArrowRight')
    await expect(rail).toHaveCSS('width', '296px')
    await expect(rail).not.toHaveClass(/rail-collapsing/)

    // Reduced motion and compact overlay collapse are deliberately immediate.
    await appWindow.emulateMedia({ reducedMotion: 'reduce' })
    await appWindow.mouse.move(700, 400)
    await address.focus()
    await expect(rail).toHaveCSS('width', '56px')
    await expect(rail).not.toHaveClass(/rail-collapsing/)
    await appWindow.emulateMedia({ reducedMotion: 'no-preference' })
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(760, 520))
    await home.focus()
    await expect(rail).toHaveCSS('width', `${Math.min(296, 760 / scale - 320)}px`)
    await address.focus()
    await expect(rail).toHaveCSS('width', '56px')
    await expect(rail).not.toHaveClass(/rail-collapsing/)
    expect(await rail.locator('.tab').first().evaluate(tab => {
      const bounds = tab.getBoundingClientRect()
      return bounds.right <= 56 && !tab.closest('[inert]')
    })).toBe(true)
  })
}
