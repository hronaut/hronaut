import { writeFile } from 'node:fs/promises'
import { expect, test } from './fixtures.js'

test('keeps independent tab controls separated and reachable at normal and compact sizes', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Tab controls</title>', active: true })")
  for (const width of [1900, 760]) {
    await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 720), width)
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${width === 760 ? 1.25 : 1})`)
    const controls = appWindow.getByRole('group', { name: 'Tab controls', exact: true })
    await expect(controls.getByRole('button')).toHaveCount(4)
    await expect.poll(() => controls.evaluate(group => {
      const buttons = [...group.querySelectorAll('button')]
      return buttons.every((button, index) => {
        const rect = button.getBoundingClientRect()
        const previous = buttons[index - 1]?.getBoundingClientRect()
        return rect.left >= 0 && rect.right <= innerWidth + 1
          && (!previous || rect.left - previous.right >= 4)
          && parseFloat(getComputedStyle(button).borderTopLeftRadius) > 0
      })
    })).toBe(true)
    await expect.poll(async () => {
      const shellBottom = await appWindow.locator('.shell').evaluate(shell => shell.getBoundingClientRect().bottom)
      const pageTop = await electronApp.evaluate(({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view =>
          'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Tab controls')
        return view?.getBounds().y
      })
      return pageTop === Math.ceil(Math.ceil(shellBottom) * (width === 760 ? 1.25 : 1))
    }).toBe(true)
    const image = await electronApp.evaluate(async ({ BrowserWindow }) =>
      (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath(`tab-controls-${width}.png`), Buffer.from(image, 'base64'))
  }
})
