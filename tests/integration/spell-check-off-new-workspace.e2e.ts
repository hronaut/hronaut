import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

// Electron turns spell checking on whenever it gives a session languages, so a workspace opened while Spell check was
// off, with languages chosen in Settings, underlined misspellings anyway.
test('keeps spell checking off in a workspace opened while it is off, with languages chosen', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Spell check off fixture</title><textarea id="note" rows="4" cols="40">Ths note</textarea>')
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const url = `http://127.0.0.1:${address.port}/compose`
  const laterUrl = `${url}?later`
  // Whether the session of the page at an address checks spelling, and in which languages.
  const checking = (address: string): Promise<{ enabled?: boolean; languages?: string[] }> => electronApp.evaluate(({ webContents }, address) => {
    const session = webContents.getAllWebContents().find(candidate => candidate.getURL() === address)?.session
    return { enabled: session?.isSpellCheckerEnabled(), languages: session?.getSpellCheckerLanguages() }
  }, address)
  try {
    await appWindow.evaluate(url => (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<unknown> } }).hronaut.newTab({ url, active: true }), url)
    await expect(appWindow.getByRole('tab', { name: /Spell check off fixture/ })).toBeVisible()
    expect(await checking(url)).toEqual({ enabled: true, languages: ['en-US'] })

    // Ukrainian only, then Spell check off.
    await appWindow.getByRole('button', { name: 'Settings' }).click()
    await appWindow.locator('.settings-nav-item').nth(0).click()
    await appWindow.getByRole('combobox', { name: 'Add language' }).selectOption({ label: 'Ukrainian' })
    await expect.poll(() => checking(url)).toEqual({ enabled: true, languages: ['en-US', 'uk'] })
    await appWindow.getByRole('button', { name: 'Remove American English' }).click()
    await expect.poll(() => checking(url)).toEqual({ enabled: true, languages: ['uk'] })
    await appWindow.getByRole('checkbox', { name: /^Spell check/ }).uncheck()
    await expect.poll(() => checking(url)).toEqual({ enabled: false, languages: ['uk'] })

    // A new workspace's session starts with American English, so it is given Ukrainian, and stays off.
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Later', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const later = created.mcpTabGroups.find(group => group.name === 'Later')!.id
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(laterUrl)}, mcpGroupId: ${JSON.stringify(later)}, active: true })`)
    await expect.poll(() => checking(laterUrl)).toEqual({ enabled: false, languages: ['uk'] })
    expect(await checking(url)).toEqual({ enabled: false, languages: ['uk'] })
  } finally {
    await closeFixtureServer(server)
  }
})
