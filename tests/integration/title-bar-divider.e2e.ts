import { expect, test } from './fixtures.js'

for (const theme of ['light', 'dark']) {
  for (const scale of [1, 1.1, 1.25]) {
    test(`draws the workspace rail and the toolbar as one surface without a divider in ${theme} at ${scale} scale`, async ({ appWindow, electronApp }, testInfo) => {
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
        // Visibility can precede layout settling after scale and view changes.
        await expect(async () => {
          const surfaces = await right.evaluate(element => {
            const style = (target: Element) => getComputedStyle(target)
            const railElement = document.querySelector('.shell-title-bar-surface.surface-rail')!
            const workspaceRail = document.querySelector('.topbar')!
            const shell = document.querySelector('.shell')!
            return {
              railBottom: railElement.getBoundingClientRect().bottom,
              rightBottom: shell.getBoundingClientRect().bottom,
              borders: [railElement, workspaceRail, element, shell].map(target => [style(target).borderBottomWidth, style(target).borderRightWidth, style(target).borderTopWidth]),
              railColor: style(railElement).backgroundColor,
              workspaceRailColor: style(workspaceRail).backgroundColor,
              rightColor: style(element).backgroundColor,
              pageSurroundColor: style(document.body).backgroundColor
            }
          })
          expect(surfaces.railBottom, 'Both title bar surfaces must end on the same horizontal edge').toBe(surfaces.rightBottom)
          expect(surfaces.borders.flat().every(width => width === '0px'), 'No line may divide the rail, the toolbar and the page surround').toBe(true)
          expect(surfaces.rightColor, 'The toolbar must share the rail surface').toBe(surfaces.railColor)
          expect(surfaces.workspaceRailColor, 'The tab rail must share the title bar surface').toBe(surfaces.railColor)
          expect(surfaces.pageSurroundColor, 'The page card must sit on the rail surface').toBe(surfaces.railColor)
        }).toPass({ timeout: 8_000 })
        await appWindow.screenshot({ path: testInfo.outputPath(`${view}-${theme}-${scale}.png`) })
      }
    })
  }
}
