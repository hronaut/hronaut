import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { closeFixtureServer, closeHronaut, expect, launchHronaut, test } from './fixtures.js'
import { answerEveryTrustedDialog, answeredTrustedDialogs } from './trusted-dialog-fixture.js'

// Global history only cleared all of it. As Chrome's Delete browsing data, a time range clears the pages visited in
// that time, with those pages in Recently closed, and leaves what was visited before it.
test('clears the history of the last hour and keeps the visits before it', async ({ profileDirectory, mcpPort }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Recent visit</title><main>Recent</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const recent = `http://127.0.0.1:${address.port}/recent`
  const old = { id: 'old-visit', url: 'https://old.example/', title: 'Old visit', visitedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), visitCount: 1 }
  await writeFile(join(profileDirectory, 'history.json'), JSON.stringify({ version: 1, entries: [old] }))
  const { app, window } = await launchHronaut(profileDirectory, mcpPort)
  try {
    const history = () => window.evaluate('window.hronautHistory.list().then((entries) => entries.map((entry) => entry.url))') as Promise<string[]>
    const closedTabs = () => window.evaluate('window.hronaut.getState().then((state) => state.closedTabs.map((tab) => tab.url))') as Promise<string[]>
    await expect.poll(history).toEqual([old.url])
    const state = await window.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(recent)}, active: true })`) as { activeTabId: string }
    await expect.poll(history).toEqual([recent, old.url])
    await window.evaluate(`window.hronaut.closeTab(${JSON.stringify(state.activeTabId)})`)
    await expect.poll(closedTabs).toContain(recent)

    await window.keyboard.press('Control+Shift+Delete')
    const section = window.getByRole('tabpanel', { name: 'Settings' }).getByRole('region', { name: 'Global history' })
    const range = section.getByRole('combobox', { name: 'Time range' })
    await expect(range).toHaveValue('allTime')
    await range.selectOption({ label: 'Last hour' })
    await answerEveryTrustedDialog(window, 'OK')
    await section.getByRole('button', { name: 'Clear history…', exact: true }).click()
    await expect.poll(history).toEqual([old.url])
    expect(await answeredTrustedDialogs(window)).toEqual(['Clear browsing history for all websites?'])
    await expect.poll(closedTabs).not.toContain(recent)
    await expect(section.locator('output.privacy-data-status:not(.janitor-status)')).toContainText('cleared for all websites')
  } finally {
    await closeHronaut(app)
    await closeFixtureServer(server)
  }
})
