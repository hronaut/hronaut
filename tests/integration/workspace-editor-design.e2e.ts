import { writeFile } from 'node:fs/promises'
import type { HronautApi, HronautSettingsApi } from '../../src/shared/types.js'
import { expect, test } from './fixtures.js'

test('workspace description stays aligned and readable across themes, sizes, and editor modes', async ({ appWindow, electronApp }, testInfo) => {
  const descriptionText = 'Investigate checkout and keep the signed-in QA session.\nNext: verify the order confirmation and saved cart.'
  const workspaceId = await appWindow.evaluate(async description => {
    const browser = (window as unknown as { hronaut: HronautApi }).hronaut
    const state = await browser.createWorkspace({ name: 'Checkout QA', description, storage: 'scratch' })
    return state.mcpTabGroups.find(group => group.name === 'Checkout QA')!.id
  }, descriptionText)

  for (const mode of ['create', 'edit']) {
    if (mode === 'create') await appWindow.getByRole('button', { name: 'Create workspace', exact: true }).click()
    else await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.getAllWindows()[0]!.webContents.send('browser:edit-tab-group', id), workspaceId)
    const editor = appWindow.getByRole('dialog', { name: mode === 'create' ? 'Create workspace' : 'Edit workspace', exact: true })
    const description = editor.getByRole('textbox', { name: 'Description', exact: true })
    await expect(description).toHaveValue(mode === 'create' ? '' : descriptionText)

    for (const theme of ['light', 'dark'] as const) {
      await appWindow.evaluate(theme => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setTheme(theme), theme)
      for (const [width, height, scale] of [[1200, 900, 1], [640, 640, 1.1], [600, 600, 1.25]] as const) {
        await electronApp.evaluate(({ BrowserWindow }, { width, height }) => {
          const window = BrowserWindow.getAllWindows()[0]!
          window.setMinimumSize(600, 600)
          window.setSize(width, height)
        }, { width, height })
        await appWindow.evaluate(scale => (window as unknown as { hronautSettings: HronautSettingsApi }).hronautSettings.setInterfaceScale(scale), scale)
        await expect.poll(() => appWindow.evaluate(() => innerWidth)).toBe(Math.round(width / scale))
        await editor.locator('.workspace-editor-body').evaluate(element => { element.scrollTop = 0 })
        await appWindow.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        // Capture the native window so Electron zoom does not crop the screenshot.
        const screenshot = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
        await writeFile(testInfo.outputPath(`workspace-${mode}-${theme}-${width}-${scale}.png`), Buffer.from(screenshot, 'base64'))

        const layout = await editor.evaluate(element => {
          const name = element.querySelector<HTMLInputElement>('#tab-group-name')!
          const description = element.querySelector<HTMLTextAreaElement>('#workspace-description')!
          const hint = [...element.querySelectorAll('small, p')].find(candidate => candidate.textContent?.startsWith('Stored locally with this workspace'))!
          const body = element.querySelector('.workspace-editor-body')!
          const rect = (node: Element) => {
            const { left, right, top, bottom, width, height } = node.getBoundingClientRect()
            return { left, right, top, bottom, width, height }
          }
          const style = (node: Element) => {
            const value = getComputedStyle(node)
            return { background: value.backgroundColor, color: value.color, borderRadius: value.borderRadius, fontFamily: value.fontFamily, fontSize: value.fontSize }
          }
          return {
            name: rect(name), description: rect(description), hint: rect(hint), body: rect(body),
            editor: rect(element), footer: rect(element.querySelector('footer')!),
            nameStyle: style(name), descriptionStyle: style(description), resize: getComputedStyle(description).resize,
            bodyOverflow: body.scrollWidth - body.clientWidth,
            viewport: { width: innerWidth, height: innerHeight }
          }
        })
        expect(Math.abs(layout.description.left - layout.name.left)).toBeLessThanOrEqual(1)
        expect(Math.abs(layout.description.width - layout.name.width)).toBeLessThanOrEqual(1)
        expect(layout.description.height).toBeGreaterThanOrEqual(96)
        expect(layout.descriptionStyle).toEqual(layout.nameStyle)
        expect(layout.resize).toBe('vertical')
        expect(layout.hint.top).toBeGreaterThanOrEqual(layout.description.bottom + 4)
        expect(Math.abs(layout.hint.left - layout.description.left)).toBeLessThanOrEqual(1)
        expect(layout.bodyOverflow).toBeLessThanOrEqual(1)
        expect(layout.body.bottom).toBeLessThanOrEqual(layout.footer.top + 1)
        expect(layout.editor.left).toBeGreaterThanOrEqual(0)
        expect(layout.editor.right).toBeLessThanOrEqual(layout.viewport.width)
        expect(layout.editor.bottom).toBeLessThanOrEqual(layout.viewport.height)
        await expect(editor.locator('footer').getByRole('button').last()).toBeInViewport()
      }
    }
    await expect(description).toHaveAccessibleDescription('Stored locally with this workspace and shown to agents when they list or resume it.')
    await description.focus()
    expect(await description.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none')
    await description.fill('x'.repeat(1000))
    expect(await description.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
    await editor.getByRole('button', { name: 'Close workspace editor', exact: true }).click()
  }
})
