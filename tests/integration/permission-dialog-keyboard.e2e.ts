import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import { trustedDialog, trustedDialogHeadline } from './trusted-dialog-fixture.js'

// A website's permission request was a system dialog. It is now Hronaut's own dialog over the page, so Hronaut keeps
// what the system dialog guaranteed: the page cannot draw over it, Enter never chooses Allow, and Escape denies.
test('hides the page under a permission dialog and answers it from the keyboard only with Deny', async ({ appWindow, electronApp }) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>Keyboard prompt</title><main>Keyboard prompt</main>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const ask = (script: string) => electronApp.evaluate(async ({ webContents }, request) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Keyboard prompt')
    if (!page) throw new Error('Permission fixture web contents was not found')
    await page.executeJavaScript(`Promise.resolve().then(() => ${request}).catch(() => undefined); true`, true)
  }, script)
  const pageVisible = () => electronApp.evaluate(({ BrowserWindow, WebContentsView }) => BrowserWindow.getAllWindows()[0]!.contentView.children
    .some((view) => view instanceof WebContentsView && view.webContents.getTitle() === 'Keyboard prompt' && view.getVisible()))
  try {
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin)}, active: true })`)
    await expect.poll(pageVisible).toBe(true)

    await ask('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
    const dialog = trustedDialog(appWindow)
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    expect(await trustedDialogHeadline(appWindow)).toBe(`${origin} wants to know your location`)
    // The page's view leaves the screen while the dialog shows, so nothing the website draws can cover or mimic it.
    await expect.poll(pageVisible).toBe(false)
    await expect(dialog.getByRole('button', { name: 'Deny', exact: true })).toBeFocused()
    await appWindow.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([
      expect.objectContaining({ origin, permission: 'geolocation', decision: 'deny' })
    ])
    await expect.poll(pageVisible).toBe(true)

    await ask('navigator.storage.persist()')
    await expect(dialog).toHaveAttribute('data-armed', 'true')
    await appWindow.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect.poll(async () => (await appWindow.evaluate('window.hronautPermissions.list()') as Array<{ permission: string, decision: string }>)
      .map((entry) => `${entry.permission}:${entry.decision}`).sort()).toEqual(['geolocation:deny', 'persistent-storage:deny'])
  } finally {
    await closeFixtureServer(server)
  }
})
