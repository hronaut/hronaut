import { writeFile } from 'node:fs/promises'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, test } from './fixtures.js'

async function capture(electronApp: ElectronApplication, path: string): Promise<void> {
  const image = await electronApp.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
  await writeFile(path, Buffer.from(image, 'base64'))
}

test('keeps the four tab controls in one capsule, reachable at normal and compact sizes', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Tab controls</title>', active: true })")
  for (const width of [1900, 760]) {
    await electronApp.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setContentSize(width, 720), width)
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${width === 760 ? 1.25 : 1})`)
    const controls = appWindow.getByRole('group', { name: 'Tab controls', exact: true })
    await expect(controls.getByRole('button')).toHaveCount(4)
    await expect.poll(() => controls.evaluate(group => {
      const capsule = group.getBoundingClientRect()
      const style = getComputedStyle(group)
      const buttons = [...group.querySelectorAll('button')]
      return {
        // One rounded, outlined capsule on its own fill.
        capsule: parseFloat(style.borderTopWidth) > 0 && parseFloat(style.borderTopLeftRadius) > 0 && style.backgroundColor !== 'rgba(0, 0, 0, 0)',
        inside: buttons.every(button => {
          const rect = button.getBoundingClientRect()
          return rect.left >= capsule.left && rect.right <= capsule.right && rect.top >= capsule.top && rect.bottom <= capsule.bottom
            && rect.left >= 0 && rect.right <= innerWidth + 1
        }),
        // Each toggle keeps its own target and its own corners inside the capsule.
        separate: buttons.every((button, index) => {
          const rect = button.getBoundingClientRect()
          const previous = buttons[index - 1]?.getBoundingClientRect()
          return (!previous || rect.left - previous.right >= 1) && rect.height >= 32 && rect.width >= 32
            && parseFloat(getComputedStyle(button).borderTopLeftRadius) > 0 && getComputedStyle(button).borderTopWidth === '0px'
        })
      }
    })).toEqual({ capsule: true, inside: true, separate: true })
    await expect.poll(async () => {
      const shellBottom = await appWindow.locator('.shell').evaluate(shell => shell.getBoundingClientRect().bottom)
      const pageTop = await electronApp.evaluate(({ BrowserWindow }) => {
        const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view =>
          'webContents' in view && (view as Electron.WebContentsView).webContents.getTitle() === 'Tab controls')
        return view?.getBounds().y
      })
      return pageTop === Math.ceil(Math.ceil(shellBottom) * (width === 760 ? 1.25 : 1))
    }).toBe(true)
    await capture(electronApp, testInfo.outputPath(`tab-controls-${width}.png`))
  }
})

type ToolbarLayout = {
  rows: number
  commands: number
  addressWidth: number
  addressCenterOffset: number
  addressRowCommands: number
  bandRight: number
  addressRight: number
  commandsInOrder: boolean
  controlsGap: number
}

async function toolbarLayout(appWindow: Page): Promise<ToolbarLayout> {
  return appWindow.locator('.toolbar').evaluate(toolbar => {
    const address = toolbar.querySelector('.address-form')!.getBoundingClientRect()
    const reload = toolbar.querySelector('.reload-button')!.getBoundingClientRect()
    const rects = [...toolbar.querySelectorAll<HTMLElement>('.toolbar-commands button')]
      .map(button => button.getBoundingClientRect())
      .filter(rect => rect.width > 0)
    const first = rects[0]!
    const last = rects[rects.length - 1]!
    const rowTops = new Set([reload, ...rects].map(rect => Math.round((rect.top + rect.height / 2) / 20)))
    const rightInset = Number.parseFloat(document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')) || 0
    return {
      rows: rowTops.size,
      commands: rects.length,
      addressWidth: Math.round(address.width),
      // Distance from the middle of the space between reload and the first command.
      addressCenterOffset: Math.round(Math.abs((address.left + address.right) / 2 - (reload.right + first.left) / 2)),
      addressRowCommands: rects.filter(rect => rect.top < address.bottom && rect.bottom > address.top).length,
      bandRight: Math.round(Math.max(...rects.map(rect => rect.right))),
      addressRight: Math.round(address.right),
      commandsInOrder: rects.every((rect, index) => index === 0 || rect.left > rects[index - 1]!.left || rect.top > rects[index - 1]!.top),
      controlsGap: rightInset > 0 ? Math.round(innerWidth - rightInset - last.right) : 20
    }
  })
}

test('centers the address field up to 520 px and moves every command into one second band on a narrow window', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Toolbar layout</title>', active: true })")
  await expect(appWindow.locator('.toolbar')).toBeVisible()
  const resize = (width: number, height: number) => electronApp.evaluate(({ BrowserWindow }, size) =>
    BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), { width, height })

  // Wide: one row, the address field stops at 520 px and sits centered between navigation and the commands.
  await resize(1900, 900)
  await expect.poll(() => toolbarLayout(appWindow)).toMatchObject({ rows: 1, addressWidth: 520 })
  const wide = await toolbarLayout(appWindow)
  expect(wide.commands).toBeGreaterThanOrEqual(10)
  expect(wide.addressRowCommands).toBe(wide.commands)
  expect(wide.addressCenterOffset).toBeLessThanOrEqual(1)
  expect(wide.controlsGap).toBeGreaterThanOrEqual(20)
  await capture(electronApp, testInfo.outputPath('toolbar-1900.png'))

  // Medium: still one row, the address takes what the commands leave.
  await resize(1440, 900)
  await expect.poll(async () => (await toolbarLayout(appWindow)).rows).toBe(1)
  expect((await toolbarLayout(appWindow)).addressWidth).toBeGreaterThan(400)

  // Narrow with the rail open: the address keeps its row and every command moves to a band below,
  // ending where the address ends, instead of a few commands staying beside it.
  await resize(1024, 768)
  await expect.poll(async () => (await toolbarLayout(appWindow)).rows).toBe(2)
  const narrow = await toolbarLayout(appWindow)
  expect(narrow.addressRowCommands).toBe(0)
  expect(narrow.addressWidth).toBeGreaterThan(400)
  expect(Math.abs(narrow.bandRight - narrow.addressRight)).toBeLessThanOrEqual(1)
  expect(narrow.commandsInOrder).toBe(true)
  expect(narrow.controlsGap).toBeGreaterThanOrEqual(20)
  expect(await appWindow.locator('.toolbar').evaluate(toolbar => toolbar.scrollWidth <= toolbar.clientWidth)).toBe(true)
  await capture(electronApp, testInfo.outputPath('toolbar-1024.png'))
})
