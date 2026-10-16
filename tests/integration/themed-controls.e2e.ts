import type { Locator } from '@playwright/test'
import type { HronautApi } from '../../src/shared/types.js'
import { expect, settleShellMotion, test } from './fixtures.js'

interface ControlStyle {
  appearance: string
  width: number
  height: number
  background: string
  border: string
  mark: string
  chevron: boolean
  paddingRight: number
  accent: string
  surface: string
}

/** How a control is drawn, with the theme's accent and raised surface resolved the same way. */
function readControl(control: Locator): Promise<ControlStyle> {
  return control.evaluate((element) => {
    const resolve = (value: string): string => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = value
      document.body.append(probe)
      const color = getComputedStyle(probe).backgroundColor
      probe.remove()
      return color
    }
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return {
      appearance: style.appearance,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      background: style.backgroundColor,
      border: style.borderTopColor,
      mark: getComputedStyle(element, '::before').transform,
      chevron: style.backgroundImage.includes('linear-gradient'),
      paddingRight: Number.parseFloat(style.paddingRight),
      accent: resolve('var(--accent)'),
      surface: resolve('var(--surface-raised)')
    }
  })
}

async function expectThemedChoice(control: Locator, checked: boolean): Promise<void> {
  const style = await readControl(control)
  expect(style).toMatchObject({ appearance: 'none', width: 16, height: 16 })
  if (checked) {
    expect(style.background).toBe(style.accent)
    expect(style.border).toBe(style.accent)
    expect(style.mark).toBe('matrix(1, 0, 0, 1, 0, 0)')
  } else {
    expect(style.background).toBe(style.surface)
    expect(style.mark).toBe('matrix(0, 0, 0, 0, 0, 0)')
  }
}

async function expectThemedSelect(control: Locator): Promise<void> {
  const style = await readControl(control)
  expect(style.appearance).toBe('none')
  expect(style.chevron).toBe(true)
  expect(style.paddingRight).toBeGreaterThanOrEqual(28)
}

for (const theme of ['light', 'dark']) {
  test(`draws radio buttons, checkboxes and selects with the ${theme} theme`, async ({ appWindow }) => {
    await appWindow.evaluate(`window.hronautSettings.setTheme('${theme}')`)
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)

    await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
    const editor = appWindow.getByRole('dialog', { name: 'Create workspace', exact: true })
    await expect(editor).toBeVisible()
    await settleShellMotion(appWindow)
    await expectThemedChoice(editor.getByRole('radio', { name: 'Start from scratch' }), true)
    await expectThemedChoice(editor.getByRole('radio', { name: 'Fork a workspace' }), false)
    const access = editor.getByRole('checkbox', { name: 'Allow direct agent access' })
    await expectThemedChoice(access, true)
    // The native control still owns the state, keyboard and label.
    await access.focus()
    await appWindow.keyboard.press('Space')
    await expect(access).not.toBeChecked()
    await settleShellMotion(appWindow)
    await expectThemedChoice(access, false)
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await expect(editor).toBeHidden()

    // The result type filter appears once there is a tab to filter.
    await appWindow.evaluate(async () => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      await api.newTab({ url: 'data:text/html,<title>Controls fixture</title>', active: true })
    })
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    const tabs = appWindow.getByRole('dialog', { name: 'Tabs' })
    await expect(tabs).toBeVisible()
    await expectThemedSelect(tabs.getByRole('combobox', { name: 'Result type' }))
    await appWindow.keyboard.press('Escape')
    await expect(tabs).toBeHidden()

    await appWindow.getByRole('button', { name: 'Page tools' }).click()
    const dockPicker = appWindow.getByRole('combobox', { name: 'Dock page tools' })
    await expectThemedSelect(dockPicker)
    await dockPicker.selectOption('left')
    await expect(dockPicker).toHaveValue('left')
  })
}
