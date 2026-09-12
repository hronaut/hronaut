import { expect, test } from './fixtures.js'

for (const theme of ['light', 'dark']) {
  for (const scale of [1, 1.1, 1.25]) {
    test(`aligns the workspace and navigation dividers in ${theme} at ${scale} scale`, async ({ appWindow, electronApp }, testInfo) => {
      await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
      await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
      await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
      await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
      await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await appWindow.evaluate(`window.hronaut.newTab({ url: 'data:text/html,<title>Divider alignment</title><body style="margin:0;background:white">', active: true })`)
      const rail = appWindow.locator('.shell-title-bar-surface.surface-rail')
      await expect(rail).toBeVisible()
      for (const view of ['page', 'home']) {
        if (view === 'home') await appWindow.getByRole('button', { name: 'Open Hronaut Home', exact: true }).click()
        const right = appWindow.locator(view === 'page' ? '.toolbar' : '.shell-title-bar-surface.surface-home')
        await expect(right).toBeVisible()
        const geometry = await right.evaluate(element => {
          const rail = document.querySelector('.shell-title-bar-surface.surface-rail')!
          const shell = document.querySelector('.shell')!
          const leftStyle = getComputedStyle(rail)
          const rightStyle = getComputedStyle(element)
          return {
            leftBottom: rail.getBoundingClientRect().bottom,
            rightBottom: shell.getBoundingClientRect().bottom,
            leftBorder: leftStyle.borderBottomWidth,
            rightBorder: rightStyle.borderBottomWidth,
            leftColor: leftStyle.borderBottomColor,
            rightColor: rightStyle.borderBottomColor
          }
        })
        expect.soft(geometry.leftBottom, 'Both dividers must end on the same horizontal edge').toBe(geometry.rightBottom)
        expect.soft(geometry.leftBorder, 'Both sides must paint the same border thickness').toBe(geometry.rightBorder)
        expect.soft(geometry.leftColor, 'The divider must use one continuous color').toBe(geometry.rightColor)
        await appWindow.screenshot({ path: testInfo.outputPath(`${view}-${theme}-${scale}.png`) })
      }
    })
  }
}
