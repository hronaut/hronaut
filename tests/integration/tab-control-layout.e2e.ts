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
    await controls.screenshot({ path: testInfo.outputPath(`tab-controls-${width}.png`) })
  }
})
