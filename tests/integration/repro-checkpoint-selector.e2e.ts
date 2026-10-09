import { createServer } from 'node:http'
import { formatReproAsPlaywright } from '../../src/shared/repro-export.js'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

test('authors a reviewed final checkpoint from a recorded target selector', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<html><title>Reuse checkpoint selector</title><main><button onclick="this.textContent=\'Saved\'">Save</button></main></html>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  try {
    const state = await appWindow.evaluate(url => (window as unknown as { hronaut: HronautApi }).hronaut.newTab({ url, active: true }), url)
    const tabId = state.activeTabId!
    await expect.poll(() => electronApp.context().pages().some(page => page.url() === url)).toBe(true)
    const page = electronApp.context().pages().find(page => page.url() === url)!
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible()
    const get = () => appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('get', tabId), tabId)
    await appWindow.evaluate(tabId => (window as unknown as { hronaut: HronautApi }).hronaut.manageRepro('start', tabId), tabId)
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => (await get()).steps.some(step => step.kind === 'click')).toBe(true)
    const recorded = await get()
    const target = recorded.steps.find(step => step.kind === 'click')!.target!
    await appWindow.getByRole('button', { name: 'Page tools', exact: true }).click()
    await appWindow.getByRole('dialog', { name: 'Page tools' }).getByRole('button', { name: /Repro recorder:/ }).click()
    const panel = appWindow.getByRole('dialog', { name: 'Repro recorder' })
    await panel.getByRole('listbox').getByRole('option').last().click()
    await panel.getByRole('button', { name: 'Use selector for checkpoint' }).click()
    await expect(panel.getByLabel('Selector', { exact: true })).toHaveValue(target.selector)
    const add = panel.getByRole('button', { name: 'Add checkpoint' })
    await expect(add).toBeDisabled()
    expect((await get()).steps.some(step => step.kind === 'expect')).toBe(false)
    await panel.getByRole('combobox', { name: 'Condition', exact: true }).selectOption('text')
    await panel.getByLabel('Exact text', { exact: true }).fill('Saved')
    await panel.getByRole('checkbox').check()
    await add.click()
    await expect.poll(async () => (await get()).steps.at(-1)?.expectation).toEqual({ condition: 'text', text: 'Saved', observedMatch: true })
    await panel.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(panel.getByRole('button', { name: 'Use selector for checkpoint' })).toHaveCount(0)
    const exported = formatReproAsPlaywright(await get())
    expect(exported).toContain('toHaveText("Saved")')
    expect(exported).not.toContain('TODO')
  } finally {
    await closeFixtureServer(server)
  }
})
