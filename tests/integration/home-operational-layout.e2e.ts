import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ElectronApplication } from '@playwright/test'
import { connectMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { BrowserState } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

const HOME_READY_TIMEOUT_MS = 20_000

async function homeScript<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ webContents }, source) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return home.executeJavaScript(source)
  }, script) as Promise<T>
}

async function readyHome(app: ElectronApplication): Promise<void> {
  await expect.poll(
    () => app.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('hronaut://home'))),
    { timeout: HOME_READY_TIMEOUT_MS }
  ).toBe(true)
  await expect.poll(
    () => homeScript(app, 'document.readyState !== "loading"'),
    { timeout: HOME_READY_TIMEOUT_MS }
  ).toBe(true)
}

/**
 * Resizes the window and waits until Home has laid out at its new width. Home sits in the page card, inset from the
 * window's edges, so its width is the card's, not the window's.
 */
async function resizeHome(app: ElectronApplication, width: number, height = 900): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [nextWidth, nextHeight]) => BrowserWindow.getAllWindows()[0]!.setSize(nextWidth!, nextHeight!), [width, height])
  await expect.poll(async () => {
    const card = await app.evaluate(({ BrowserWindow, WebContentsView }) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
        candidate instanceof WebContentsView && candidate.webContents.getURL().startsWith('hronaut://home')
      )) as Electron.WebContentsView | undefined
      const bounds = view?.getBounds()
      return { width: bounds?.width ?? 0, height: bounds?.height ?? 0 }
    })
    const inner = await homeScript<{ width: number; height: number }>(app, '({ width: innerWidth, height: innerHeight })')
    return card.width > width - 60 && card.width <= width && card.height > 0 && card.height < height
      && inner.width === card.width && inner.height === card.height
  }).toBe(true)
}

async function captureHome(app: ElectronApplication): Promise<Buffer> {
  const png = await app.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home web contents was not found')
    return (await home.capturePage()).toPNG().toString('base64')
  })
  return Buffer.from(png, 'base64')
}

test('Home keeps its content width and position when switching between short and scrollable tabs', async ({ electronApp }) => {
  await readyHome(electronApp)
  await expect.poll(() => homeScript(electronApp, 'Boolean(document.getElementById("home-tab-workspaces")?.offsetParent)')).toBe(true)
  // Exercise the returning-profile short view as well as long diagnostics.
  await homeScript(electronApp, `localStorage.setItem('hronaut.home.onboarded', 'true'); import(document.querySelector('script[type="module"]').src).then(module => module.homeController.refresh())`)
  // In narrow windows the live activity moves under the workspace cards, so Workspaces scrolls there too; a tool search
  // that matches nothing keeps one view short at every width, whatever the fonts.
  await homeScript(electronApp, `(() => {
    const search = document.getElementById('tool-search');
    search.value = 'no-such-hronaut-tool';
    search.dispatchEvent(new Event('input'));
  })()`)
  for (const width of [1200, 760]) {
    await resizeHome(electronApp, width)
    await homeScript(electronApp, 'document.getElementById("home-tab-workspaces").click()')
    const measure = () => homeScript<{ x: number; width: number; scrollable: boolean }>(electronApp, `(() => {
      const page = document.querySelector('.page');
      if (!page) throw new Error('Home page container was not found');
      const bounds = page.getBoundingClientRect();
      return { x: bounds.x, width: bounds.width, scrollable: document.documentElement.scrollHeight > innerHeight };
    })()`)
    const initial = await measure()
    const scrollStates = new Set([initial.scrollable])
    for (const tab of ['connect', 'tools', 'overview', 'workspaces']) {
      await homeScript(electronApp, `document.getElementById(${JSON.stringify(`home-tab-${tab}`)}).click()`)
      const current = await measure()
      scrollStates.add(current.scrollable)
      expect.soft(current.width, `${width}/${tab}: content width`).toBe(initial.width)
      expect.soft(current.x, `${width}/${tab}: content position`).toBe(initial.x)
    }
    expect(scrollStates.size, `${width}: exercised both short and scrollable Home tabs`).toBe(2)
  }
})

test('Home scrolls live activity inside its own column in a short window and keeps the workspace cards usable', async ({ electronApp, appWindow, mcpPort, mcpToken }) => {
  const site = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>Page ${request.url}</title><h1>${request.url}</h1>`)
  })
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`
  const client = new Client({ name: 'Codex', version: '1.0.0' })
  const call = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await client.callTool({ name, arguments: args }) as CallToolResult
    const text = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    expect(result.isError, text).not.toBe(true)
    return text
  }
  try {
    await expect.poll(async () => {
      try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } }))
    // An agent opens many different pages, far more steps than a short window can show at once.
    await connectMcpWorkspace(client, 'Busy research', false)
    const tabId = (JSON.parse(await call('browser_new_tab', { url: `${origin}/page-0`, active: true })) as BrowserState).activeTabId!
    const pages = 24
    for (let index = 1; index <= pages; index++) await call('browser_navigate', { tabId, url: `${origin}/page-${index}` })
    await appWindow.evaluate('window.hronaut.openHome()')
    await expect.poll(() => electronApp.context().pages().some(page => page.url().startsWith('hronaut://home'))).toBe(true)
    const home = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))!
    const activity = home.getByRole('complementary', { name: 'Live activity', exact: true })
    const list = activity.getByRole('list', { name: 'Live activity', exact: true })
    const rows = list.getByRole('listitem')
    // Each page is its own row, newest first.
    await expect.poll(() => rows.count()).toBeGreaterThan(pages)
    await expect(rows.first()).toContainText(`/page-${pages}`)
    const card = home.getByRole('article', { name: 'Busy research', exact: true })
    const openCard = card.getByRole('button', { name: 'Open Busy research', exact: true })

    for (const width of [1200, 760]) {
      await resizeHome(electronApp, width, 640)
      await home.evaluate(() => { scrollTo(0, 0); document.getElementById('live-activity-list')!.scrollTop = 0 })
      const layout = await home.evaluate(() => {
        const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().toJSON() as DOMRect
        const list = document.getElementById('live-activity-list')!
        return {
          innerHeight, feed: bounds('#live-activity'), card: bounds('.home-workspace-card'),
          listHeight: list.clientHeight, listContent: list.scrollHeight, overflow: document.documentElement.scrollWidth - innerWidth
        }
      })
      expect.soft(layout.overflow, `${width}: no sideways scrolling`).toBeLessThanOrEqual(1)
      // The column keeps to its own height and its steps scroll inside it.
      expect(layout.feed.height, `${width}: activity column height`).toBeLessThanOrEqual(width > 860 ? layout.innerHeight - 32 + 1 : 421)
      expect(layout.listContent, `${width}: steps overflow their list`).toBeGreaterThan(layout.listHeight + 100)
      // Wide, the column sits beside the cards; narrow, under them. It never covers a card.
      if (width > 860) expect(layout.card.right).toBeLessThanOrEqual(layout.feed.left)
      else expect(layout.card.bottom).toBeLessThanOrEqual(layout.feed.top)

      // The cards stay usable: in view and not covered by the column, and the last action of their ⋯ menu can be
      // scrolled to and takes the pointer. Trial clicks check this without acting.
      await expect(openCard).toBeInViewport()
      await openCard.click({ trial: true })
      await card.getByLabel('More actions for Busy research', { exact: true }).click()
      const clear = card.getByRole('button', { name: 'Clear…', exact: true })
      await clear.scrollIntoViewIfNeeded()
      await expect(clear).toBeInViewport()
      await clear.click({ trial: true })
      await home.keyboard.press('Escape')
      await expect(clear).toBeHidden()

      // A wheel over the steps scrolls them, not the page, and the oldest step is reached inside the column.
      await list.scrollIntoViewIfNeeded()
      const pageScroll = await home.evaluate(() => scrollY)
      const scrolled = list.evaluate(node => new Promise<void>(resolve => node.addEventListener('scrollend', () => resolve(), { once: true })))
      await list.hover()
      await home.mouse.wheel(0, 240)
      await scrolled
      expect(await list.evaluate(node => node.scrollTop), `${width}: steps scrolled`).toBeGreaterThan(0)
      expect(await home.evaluate(() => scrollY), `${width}: page stayed put`).toBe(pageScroll)
      await rows.last().scrollIntoViewIfNeeded()
      await expect(rows.last()).toBeInViewport()
      expect(await home.evaluate(() => scrollY), `${width}: oldest step reached inside the column`).toBe(pageScroll)
    }

    // The oldest step opens its workspace, and so does the card.
    await rows.last().getByRole('button').click()
    await expect.poll(async () => (await appWindow.evaluate('window.hronaut.getState()') as BrowserState).activeTabId).toBe(tabId)
    await appWindow.evaluate('window.hronaut.openHome()')
    await home.evaluate(() => scrollTo(0, 0))
    await openCard.click()
    await expect.poll(async () => (await appWindow.evaluate('window.hronaut.getState()') as BrowserState).activeTabId).toBe(tabId)
  } finally {
    await client.close()
    await closeFixtureServer(site)
  }
})

test('Home keeps client setup accessible in a compact layout across themes and languages', async ({ electronApp, appWindow }, testInfo) => {
  const home = async <T>(source: string): Promise<T> => electronApp.evaluate(async ({ webContents }, script) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))
    if (!page) throw new Error('Home contents unavailable')
    return page.executeJavaScript(script)
  }, source) as Promise<T>
  await expect.poll(() => electronApp.evaluate(({ webContents }) => webContents.getAllWebContents().some(contents => contents.getURL().startsWith('hronaut://home')))).toBe(true)
  await expect.poll(() => home('Boolean(document.getElementById("guide-name")?.textContent)')).toBe(true)
  for (const locale of ['en-US', 'uk-UA']) {
    await appWindow.evaluate(`window.hronautSettings.setLanguagePreference(${JSON.stringify(locale)})`)
    await expect.poll(() => home('document.documentElement.lang')).toBe(locale)
    for (const theme of ['light', 'dark']) {
      await appWindow.evaluate(`window.hronautSettings.setTheme(${JSON.stringify(theme)})`)
      const page = electronApp.context().pages().find(page => page.url().startsWith('hronaut://home'))
      if (!page) throw new Error('Home page unavailable')
      await page.emulateMedia({ colorScheme: null })
      await home("document.querySelector('[data-home-view=connect]').click()")
      await expect.poll(() => home('matchMedia("(prefers-color-scheme: dark)").matches')).toBe(theme === 'dark')
      for (const width of [1200, 760]) {
        await resizeHome(electronApp, width)
        await home('scrollTo(0, 0); new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        const layout = await home<{ setupTop: number; copyTop: number; guideBottom: number; titleSize: number; background: string; overflow: number; listHeight: number }>(`(() => ({
          setupTop: document.getElementById('setup').getBoundingClientRect().top,
          copyTop: document.querySelector('[data-copy-target="guide-code"]').getBoundingClientRect().top,
          guideBottom: document.querySelector('[data-agent-guide]').getBoundingClientRect().bottom,
          titleSize: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
          background: getComputedStyle(document.body).backgroundImage,
          overflow: document.documentElement.scrollWidth - innerWidth,
          listHeight: document.getElementById('agent-list').getBoundingClientRect().height
        }))()`)
        expect.soft(layout.setupTop, `${locale}/${theme}/${width}: setup starts near the navigation`).toBeLessThan(300)
        expect.soft(layout.copyTop, `${locale}/${theme}/${width}: primary setup action is immediately reachable`).toBeLessThan(600)
        expect.soft(layout.guideBottom, `${locale}/${theme}/${width}: setup guide is above the fold`).toBeLessThan(740)
        expect.soft(layout.titleSize).toBeLessThanOrEqual(28)
        expect.soft(layout.background).toBe('none')
        expect.soft(layout.overflow).toBeLessThanOrEqual(1)
        expect.soft(layout.listHeight).toBeLessThanOrEqual(290)
        const png = await electronApp.evaluate(async ({ webContents }) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith('hronaut://home'))!
          return (await page.capturePage()).toPNG().toString('base64')
        })
        await writeFile(testInfo.outputPath(`home-${locale}-${theme}-${width}.png`), Buffer.from(png, 'base64'))
      }
    }
  }
})

test('Home keeps MCP readiness diagnostics readable at desktop and compact widths', async ({ electronApp }, testInfo) => {
  await readyHome(electronApp)
  await homeScript(electronApp, 'document.getElementById("home-tab-overview").click()')

  for (const width of [1200, 760]) {
    await resizeHome(electronApp, width)
    await expect.poll(() => homeScript(electronApp, `(() => {
      const overview = document.getElementById('home-overview');
      const heading = [...document.querySelectorAll('h1, h2, h3')].find(node => node.textContent?.trim() === 'MCP readiness');
      return !overview?.hidden && Boolean(heading?.getBoundingClientRect().height)
        && Boolean(document.getElementById('readiness-tool-inventory')?.getBoundingClientRect().height)
        && Boolean(document.getElementById('readiness-verify')?.getBoundingClientRect().height);
    })()`)).toBe(true)
    const layout = await homeScript<{ overflow: number; panelWidth: number; reportWidth: number }>(electronApp, `(() => {
      const panel = document.querySelector('.readiness');
      const report = document.querySelector('.readiness-report');
      if (!panel || !report) throw new Error('MCP readiness layout was not found');
      return {
        overflow: document.documentElement.scrollWidth - innerWidth,
        panelWidth: panel.getBoundingClientRect().width,
        reportWidth: report.getBoundingClientRect().width
      };
    })()`)
    expect.soft(layout.overflow).toBeLessThanOrEqual(1)
    expect.soft(layout.panelWidth).toBeGreaterThan(260)
    expect.soft(layout.reportWidth).toBeLessThanOrEqual(layout.panelWidth)
    await writeFile(testInfo.outputPath(`home-readiness-${width}.png`), await captureHome(electronApp))
  }
})
