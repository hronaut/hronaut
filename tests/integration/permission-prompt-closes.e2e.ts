import { createServer } from 'node:http'
import type { ElectronApplication } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

interface ClosingPromptProbe {
  shown: string[]
  closed: string[]
  pending: Array<(value: Electron.MessageBoxReturnValue) => void>
}

/** Records each permission prompt, answers it only when asked, and closes it when its signal aborts, as Electron does. */
async function installClosingPromptProbe(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ dialog }) => {
    const probe: ClosingPromptProbe = { shown: [], closed: [], pending: [] }
    ;(globalThis as typeof globalThis & { __closingPromptProbe?: ClosingPromptProbe }).__closingPromptProbe = probe
    dialog.showMessageBox = (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as Electron.MessageBoxOptions
      const message = String(options.message)
      probe.shown.push(message)
      return new Promise((resolve) => {
        probe.pending.push(resolve)
        options.signal?.addEventListener('abort', () => {
          probe.closed.push(message)
          resolve({ response: options.cancelId ?? 0, checkboxChecked: false })
        })
      })
    }
  })
}

async function promptProbe(electronApp: ElectronApplication): Promise<Omit<ClosingPromptProbe, 'pending'>> {
  return electronApp.evaluate(() => {
    const probe = (globalThis as typeof globalThis & { __closingPromptProbe?: ClosingPromptProbe }).__closingPromptProbe!
    return { shown: [...probe.shown], closed: [...probe.closed] }
  })
}

async function askForLocation(electronApp: ElectronApplication, title: string, frameUrlEnd?: string): Promise<void> {
  await electronApp.evaluate(async ({ webContents }, target) => {
    const page = webContents.getAllWebContents().find((contents) => contents.getTitle() === target.title)
    const frame = target.frameUrlEnd
      ? page?.mainFrame.framesInSubtree.find((candidate) => candidate.url.endsWith(target.frameUrlEnd!))
      : page?.mainFrame
    if (!frame) throw new Error(`The frame of ${target.title} was not found`)
    await frame.executeJavaScript('navigator.geolocation.getCurrentPosition(() => undefined, () => undefined)')
  }, { title, frameUrlEnd })
}

test('closes a permission prompt once its page reloads or its frame is removed, so the next prompt shows', async ({
  appWindow,
  electronApp
}) => {
  // A prompt stayed open after its page had moved on, and every prompt after it, from any tab, waited behind it.
  const pages: Record<string, string> = {
    '/reloads': '<!doctype html><title>Prompt reloads</title><main>Reloads</main>',
    '/waits': '<!doctype html><title>Prompt waits</title><main>Waits</main>',
    '/widget': '<!doctype html><title>Prompt widget</title><main>Widget</main>'
  }
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    if (request.url === '/host') {
      response.end(`<!doctype html><title>Prompt host</title><iframe allow="geolocation" src="http://localhost:${port}/widget"></iframe>`)
      return
    }
    response.end(pages[request.url ?? ''] ?? '<!doctype html><title>Other</title>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Permission fixture did not expose a port')
  const port = address.port
  const origin = `http://127.0.0.1:${port}`
  const open = async (path: string, title: string): Promise<string> => {
    const tabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin + path)}, active: true }).then((state) => state.activeTabId)`) as string
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then((state) =>
      state.tabs.find((tab) => tab.id === ${JSON.stringify(tabId)})?.title
    )`)).toBe(title)
    return tabId
  }
  try {
    const reloading = await open('/reloads', 'Prompt reloads')
    await open('/waits', 'Prompt waits')
    await installClosingPromptProbe(electronApp)

    await askForLocation(electronApp, 'Prompt reloads')
    await expect.poll(async () => (await promptProbe(electronApp)).shown).toHaveLength(1)
    await askForLocation(electronApp, 'Prompt waits')
    await appWindow.evaluate(`window.hronaut.reload(${JSON.stringify(reloading)})`)
    await expect.poll(async () => (await promptProbe(electronApp)).closed).toHaveLength(1)
    await expect.poll(async () => (await promptProbe(electronApp)).shown).toHaveLength(2)
    await electronApp.evaluate(() => {
      (globalThis as typeof globalThis & { __closingPromptProbe?: ClosingPromptProbe }).__closingPromptProbe!.pending[1]!({ response: 0, checkboxChecked: false })
    })
    await expect.poll(() => appWindow.evaluate('window.hronautPermissions.list()')).toEqual([
      expect.objectContaining({ origin, permission: 'geolocation', decision: 'deny' })
    ])

    await open('/host', 'Prompt host')
    await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents()
      .find((contents) => contents.getTitle() === 'Prompt host')?.mainFrame.framesInSubtree.some((frame) => frame.url.endsWith('/widget')))).toBe(true)
    await askForLocation(electronApp, 'Prompt host', '/widget')
    await expect.poll(async () => (await promptProbe(electronApp)).shown).toHaveLength(3)
    await electronApp.evaluate(async ({ webContents }) => {
      await webContents.getAllWebContents().find((contents) => contents.getTitle() === 'Prompt host')!
        .executeJavaScript("document.querySelector('iframe').remove()")
    })
    await expect.poll(async () => (await promptProbe(electronApp)).closed).toHaveLength(2)
    expect(await appWindow.evaluate('window.hronautPermissions.list()')).toHaveLength(1)
  } finally {
    await closeFixtureServer(server)
  }
})
