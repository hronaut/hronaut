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
  addressSlack: number
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
    // A command starts a new row when its middle sits below the previous row's bottom.
    let rows = 1
    let rowBottom = reload.bottom
    for (const rect of rects) {
      if (rect.top + rect.height / 2 > rowBottom) rows += 1
      rowBottom = Math.max(rowBottom, rect.bottom)
    }
    const rightInset = Number.parseFloat(document.documentElement.style.getPropertyValue('--titlebar-controls-right-runtime')) || 0
    return {
      rows,
      commands: rects.length,
      addressWidth: Math.round(address.width),
      // Space left between reload, the address field and the first command: only their margins when the field fills.
      addressSlack: Math.round(first.left - address.right + address.left - reload.right),
      addressRowCommands: rects.filter(rect => rect.top < address.bottom && rect.bottom > address.top).length,
      bandRight: Math.round(Math.max(...rects.map(rect => rect.right))),
      addressRight: Math.round(address.right),
      commandsInOrder: rects.every((rect, index) => index === 0 || rect.left > rects[index - 1]!.left || rect.top > rects[index - 1]!.top),
      controlsGap: Math.round(innerWidth - rightInset - last.right)
    }
  })
}

const resizeWindow = (electronApp: ElectronApplication, width: number, height: number) => electronApp.evaluate(({ BrowserWindow }, size) =>
  BrowserWindow.getAllWindows()[0]!.setContentSize(size.width, size.height), { width, height })

test('fills the toolbar with the address field and moves every command into one second band on a narrow window', async ({ appWindow, electronApp }, testInfo) => {
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Toolbar layout</title>', active: true })")
  await expect(appWindow.locator('.toolbar')).toBeVisible()
  const resize = (width: number, height: number) => resizeWindow(electronApp, width, height)

  // Wide: one row, and the address field takes all the space between navigation and the commands
  // instead of stopping at 520 px in the middle of it.
  await resize(1900, 900)
  await expect.poll(async () => (await toolbarLayout(appWindow)).rows).toBe(1)
  const wide = await toolbarLayout(appWindow)
  expect(wide.commands).toBeGreaterThanOrEqual(10)
  expect(wide.addressRowCommands).toBe(wide.commands)
  expect(wide.addressWidth).toBeGreaterThan(800)
  // Reload's 6 px margin, the commands' 6 px margin and two 5 px gaps.
  expect(wide.addressSlack).toBeLessThanOrEqual(24)
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

  // Widths where the address row has room to spare: the field fills its row
  // once the commands wrap, so the band still ends where the address ends.
  for (const [width, scale] of [[1100, 1], [1140, 1], [1220, 1.1]] as const) {
    await appWindow.evaluate(`window.hronautSettings.setInterfaceScale(${scale})`)
    await resize(width, 768)
    await expect.poll(async () => {
      const layout = await toolbarLayout(appWindow)
      return layout.rows === 2 && layout.addressRowCommands === 0 && Math.abs(layout.bandRight - layout.addressRight) <= 1
    }, { message: `${width} px at ${scale}` }).toBe(true)
  }
  await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1)')
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('top')`)
  await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1.1)')
  await resize(800, 768)
  await expect.poll(async () => {
    const layout = await toolbarLayout(appWindow)
    return layout.rows >= 2 && layout.addressRowCommands === 0 && Math.abs(layout.bandRight - layout.addressRight) <= 1
  }, { message: 'tabs above the page at 110%' }).toBe(true)
  await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1)')
})

test('lets status pills in the address field widen it instead of squeezing out the address', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Pills</title>', active: true })")
  await resizeWindow(electronApp, 1900, 900)
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  await expect.poll(async () => Math.round((await address.boundingBox())?.width ?? 0)).toBeGreaterThan(300)
  // Three of the widest pills the field can carry at once, built with the real classes.
  await appWindow.locator('.address-form').evaluate(form => {
    for (const [name, label] of [
      ['emulation-pill', 'Emulation application unknown'],
      ['emulation-pill', 'Offline · iPhone 15 Pro Max'],
      ['network-routes-pill', '12 request routes']
    ]) {
      const pill = document.createElement('span')
      pill.className = `${name} test-pill`
      pill.append(Object.assign(document.createElement('span'), { textContent: label }))
      form.append(pill)
    }
  })
  try {
    await expect.poll(async () => Math.round((await address.boundingBox())?.width ?? 0)).toBeGreaterThan(300)
    expect(await appWindow.locator('.toolbar').evaluate(toolbar => toolbar.scrollWidth <= toolbar.clientWidth)).toBe(true)
  } finally {
    await appWindow.locator('.address-form').evaluate(form => form.querySelectorAll('.test-pill').forEach(pill => pill.remove()))
  }
})

test('keeps a pressed toggle distinct from a hovered one and the capsule out of the window drag area', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Pressed</title>', active: true })")
  await resizeWindow(electronApp, 1600, 900)
  await appWindow.evaluate(`(async () => {
    const state = await window.hronaut.getState()
    await window.hronaut.setTabMuted(state.activeTabId, true)
  })()`)
  const controls = appWindow.getByRole('group', { name: 'Tab controls', exact: true })
  const mute = controls.locator('.tab-mute-button')
  await expect(mute).toHaveAttribute('aria-pressed', 'true')
  const look = () => mute.evaluate(button => ({ background: getComputedStyle(button).backgroundColor, ring: getComputedStyle(button).boxShadow }))
  const pressed = await look()
  expect(pressed.ring).toContain('inset')
  await mute.hover()
  await expect.poll(async () => (await look()).ring).not.toBe(pressed.ring)
  const pressedHover = await look()
  expect(pressedHover.background).toBe(pressed.background)
  expect(pressedHover.ring).toContain('inset')
  // An unpressed toggle under the pointer has no ring and a different fill.
  const freeze = controls.locator('.page-lifecycle-button')
  await expect(freeze).toHaveAttribute('aria-pressed', 'false')
  await freeze.hover()
  await expect.poll(() => freeze.evaluate(button => getComputedStyle(button).boxShadow)).toBe('none')
  expect(await freeze.evaluate(button => getComputedStyle(button).backgroundColor)).not.toBe(pressed.background)
  // The capsule's own edge is part of the control, not a handle that drags the window.
  if (await appWindow.locator('.custom-title-bar').count()) {
    expect(await controls.evaluate(group => getComputedStyle(group).getPropertyValue('-webkit-app-region'))).toBe('no-drag')
  }
})

test('keeps address suggestions under the field when the toolbar changes width', async ({ appWindow, electronApp }) => {
  await appWindow.evaluate(`window.hronautSettings.setTabPosition('left')`)
  await appWindow.evaluate("window.hronaut.newTab({ url: 'data:text/html,<title>Anchor page</title>', active: true })")
  await resizeWindow(electronApp, 1900, 900)
  await appWindow.evaluate("window.hronautBookmarks.add('https://example.test/anchor', 'Anchor fixture')")
  const address = appWindow.getByRole('combobox', { name: 'Address', exact: true })
  await address.fill('Anchor')
  await expect(address).toHaveAttribute('aria-expanded', 'true')
  const offset = async () => {
    const expected = await appWindow.locator('.address-form').evaluate(form => {
      const box = form.getBoundingClientRect()
      return { x: Math.round(box.left - 1), width: Math.round(box.width + 2) }
    })
    const actual = await electronApp.evaluate(({ BrowserWindow }) => {
      const view = BrowserWindow.getAllWindows()[0]!.contentView.children.find(view => 'webContents' in view && (view as Electron.WebContentsView).webContents.getURL().includes('address-overlay.html'))
      return view?.getBounds()
    })
    // The field can sit on a half pixel; the overlay's bounds are whole pixels.
    return Math.abs((actual?.x ?? -1000) - expected.x) <= 1 && Math.abs((actual?.width ?? -1000) - expected.width) <= 1
  }
  await expect.poll(offset).toBe(true)
  // A wider command group narrows the field, which fills the toolbar, and the suggestions follow its edges.
  const before = await appWindow.locator('.address-form').evaluate(form => form.getBoundingClientRect().width)
  await appWindow.locator('.toolbar-commands').evaluate(group => {
    group.append(Object.assign(document.createElement('span'), { className: 'test-spacer', style: 'display:block;width:160px;height:8px' }))
  })
  try {
    await expect.poll(() => appWindow.locator('.address-form').evaluate(form => form.getBoundingClientRect().width)).toBeLessThan(before - 100)
    await expect(address).toBeFocused()
    await expect.poll(offset).toBe(true)
  } finally {
    await appWindow.locator('.toolbar-commands').evaluate(group => group.querySelector('.test-spacer')?.remove())
  }
  await expect.poll(offset).toBe(true)
})
