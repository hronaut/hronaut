import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import type { Locator, Page } from '@playwright/test'
import { closeFixtureServer, expect, test } from './fixtures.js'

async function startDesignFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path === '/workflow') {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Release readiness</title><style>
        *{box-sizing:border-box}body{margin:0;background:#0f1623;color:#e9eef8;font:16px/1.6 system-ui}main{max-width:1120px;margin:auto;padding:56px 48px}small{color:#94a8c6;letter-spacing:.13em;text-transform:uppercase}h1{font-size:48px;letter-spacing:-.04em;line-height:1.1;margin:14px 0}h2{font-size:24px;margin:0 0 20px}p{color:#aebcd1}.hero{display:flex;justify-content:space-between;gap:24px;align-items:center}.badge{padding:8px 14px;border:1px solid #497460;border-radius:20px;color:#b3ecd0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:36px 0}.stat,.section{background:#192438;border:1px solid #34415a;border-radius:16px;padding:24px}.stat strong{font-size:38px;display:block;line-height:1.3}.stat span{color:#aebcd1}.section{margin:24px 0}table{width:100%;border-collapse:collapse;text-align:left}th{font-size:12px;color:#aebcd1;text-transform:uppercase;letter-spacing:.08em}td,th{padding:18px 12px;border-bottom:1px solid #34415a}tr:last-child td{border-bottom:0}.pill{display:inline-block;border-radius:20px;padding:4px 11px;font-size:12px;background:#214c40;color:#b6f4d8}.review{background:#544728;color:#ffe4a6}.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}.step{padding:16px 0;border-top:1px solid #34415a}.step strong{display:block}.step span{font-size:14px;color:#aebcd1}footer{margin-top:32px;font-size:13px;color:#8498b7}
      </style></head><body><main><div class="hero"><div><small>Launch desk · synthetic workspace</small><h1>Release readiness</h1><p>One place to review what works, what changed, and what needs attention.</p></div><span class="badge">Review in progress</span></div><div class="stats"><div class="stat"><strong>24</strong><span>Checks passed</span></div><div class="stat"><strong>2</strong><span>Ready for review</span></div><div class="stat"><strong>0</strong><span>Blocking issues</span></div></div><section class="section"><h2>Today's verification</h2><table><thead><tr><th>Workflow</th><th>Last check</th><th>Status</th></tr></thead><tbody><tr><td>Workspace handoff</td><td>Independent QA</td><td><span class="pill">Passed</span></td></tr><tr><td>Keyboard navigation</td><td>Desktop and compact</td><td><span class="pill">Passed</span></td></tr><tr><td>Full-page inspection</td><td>Review screenshots</td><td><span class="pill review">Review</span></td></tr><tr><td>Recovery after reload</td><td>Edge-case checks</td><td><span class="pill">Passed</span></td></tr></tbody></table></section><div class="grid"><section class="section"><h2>Quality checklist</h2><div class="step"><strong>Reproduce the behavior</strong><span>Keep a small, repeatable set of steps.</span></div><div class="step"><strong>Protect the fix</strong><span>Add a regression assertion for the expected result.</span></div><div class="step"><strong>Verify visually</strong><span>Check the same page at different window sizes.</span></div></section><section class="section"><h2>Next up</h2><div class="step"><strong>Review the final changes</strong><span>Confirm the complete workflow, including recovery.</span></div><div class="step"><strong>Share the evidence</strong><span>Keep reproduction steps and results together.</span></div><div class="step"><strong>Prepare a release</strong><span>Publish after the release checks are complete.</span></div></section></div><section class="section"><h2>Review notes</h2><p>This is a local demonstration page with synthetic information. It illustrates how a full-page preview preserves context beyond the first screen.</p><p>All values, status labels, and workflow descriptions are fixtures. They do not describe a real project or release.</p></section><footer>Local design fixture · no accounts · no external requests</footer></main></body></html>`)
      return
    }
    const tall = path === '/tall'
    const wide = path === '/wide'
    const title = tall ? 'Complete project plan' : wide ? 'Wide project board' : path.startsWith('/task-') ? `Project task ${path.slice(6)}` : 'Viewport corner markers'
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
      *{box-sizing:border-box}html,body{margin:0;font:20px system-ui;background:#182238;color:white}
      main{padding:70px 140px}h1{font-size:42px}p{max-width:700px;line-height:1.6}
      .marker{position:fixed;width:110px;height:110px}.tl{left:0;top:0;background:#ed2639}.tr{right:0;top:0;background:#26d65b}
      .bl{left:0;bottom:0;background:#2663ed}.br{right:0;bottom:0;background:#edc926}
      .band{height:180px;display:grid;place-items:center;font-size:36px;font-weight:bold;color:#101820}
      .wide{position:relative;width:2400px;height:1200px}.wide .marker{position:absolute}.top{background:#ed26cf}.bottom{background:#26d6cf}.plan{height:2400px;padding:48px 120px;background:linear-gradient(#182238,#32486a)}
      </style></head><body>${tall
        ? '<header class="band top">PROJECT START — TOP OF PAGE</header><main class="plan"><h1>Release plan</h1><p>All content is synthetic. The final milestone is at the bottom of this long page.</p><h2 style="margin-top:900px">Implementation and review</h2><p>Design review, regression checks, and independent verification.</p></main><footer class="band bottom">FINAL MILESTONE — BOTTOM OF PAGE</footer>'
        : wide ? '<div class="wide"><div class="marker tl"></div><div class="marker tr"></div><div class="marker bl"></div><div class="marker br"></div><main><h1>Wide project board</h1><p>The right edge and bottom extend beyond the current viewport.</p></main></div>'
        : `<div class="marker tl"></div><div class="marker tr"></div><div class="marker bl"></div><div class="marker br"></div><main><h1>${title}</h1><p>Four colored corner markers identify the entire current viewport. Every edge must remain visible in the overview preview.</p></main>`
      }</body></html>`)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Design fixture has no port')
  return { url: `http://127.0.0.1:${address.port}`, close: () => closeFixtureServer(server) }
}

async function colorCounts(page: Page, image: Locator): Promise<Record<string, number>> {
  return imageColorCounts(page, (await image.screenshot()).toString('base64'))
}

async function imageColorCounts(page: Page, png: string): Promise<Record<string, number>> {
  return page.evaluate(async (base64) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${base64}`)).blob())
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const counts: Record<string, number> = { red: 0, green: 0, blue: 0, yellow: 0, magenta: 0, cyan: 0 }
    for (let index = 0; index < pixels.length; index += 4) {
      const [r, g, b] = [pixels[index]!, pixels[index + 1]!, pixels[index + 2]!]
      if (r > 180 && g < 105 && b < 130) counts.red!++
      if (g > 155 && r < 110 && b < 145) counts.green!++
      if (b > 180 && r < 110 && g < 145) counts.blue!++
      if (r > 180 && g > 145 && b < 100) counts.yellow!++
      if (r > 180 && b > 155 && g < 105) counts.magenta!++
      if (g > 155 && b > 155 && r < 110) counts.cyan!++
    }
    return counts
  }, png)
}

async function controlContrast(control: Locator): Promise<number> {
  return control.evaluate((element) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')!
    const rgba = (color: string): number[] => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const foreground = rgba(getComputedStyle(element).color)
    const layers: number[][] = []
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = rgba(getComputedStyle(node).backgroundColor)
      layers.push(layer)
      if (layer[3] === 255) break
    }
    let background = [255, 255, 255]
    for (const layer of layers.reverse()) {
      const alpha = layer[3]! / 255
      background = background.map((channel, index) => layer[index]! * alpha + channel * (1 - alpha))
    }
    const luminance = (channels: number[]): number => channels.slice(0, 3).reduce((sum, channel, index) => {
      const srgb = channel / 255
      return sum + (srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]!
    }, 0)
    const a = luminance(foreground)
    const b = luminance(background)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  })
}

async function openFixture(page: Page, url: string, title: string): Promise<string> {
  const tabId = await page.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(url)}, active: true }).then(state => state.activeTabId)`) as string
  await expect.poll(() => page.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.title)`)).toBe(title)
  await expect.poll(() => page.evaluate(`window.hronaut.getTabOverviewPreviews([${JSON.stringify(tabId)}]).then(previews => previews.length)`)).toBe(1)
  return tabId
}

test('keeps sparse overview controls at the bottom and all viewport corners visible', async ({ appWindow, electronApp }, testInfo) => {
  const fixture = await startDesignFixture()
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1900, 1100))
    const tabId = await openFixture(appWindow, fixture.url, 'Viewport corner markers')
    const closedTabId = await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${fixture.url}/task-closed`)}, active: false }).then(state => state.tabs.find(tab => tab.url === ${JSON.stringify(`${fixture.url}/task-closed`)})?.id)`) as string
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(closedTabId)})?.title)`)).toBe('Project task closed')
    await appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(closedTabId)})`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getTabOverviewPreviews([${JSON.stringify(tabId)}]).then(previews => previews.length)`)).toBe(1)
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    const overview = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
    const preview = overview.locator('.tab-overview-preview').first()
    await expect(preview.locator('img')).toHaveAttribute('src', /^data:image/)
    await expect(overview.locator('.tab-search-count')).toContainText('1 open')
    await expect(overview.locator('.tab-search-count')).toContainText('1 closed')
    await expect(overview.locator('.recently-closed')).toContainText('Project task closed')
    await appWindow.screenshot({ path: testInfo.outputPath('single-tab-wide.png') })
    const list = overview.locator('.tab-search-list')
    expect(await list.evaluate(element => element.scrollTop), 'Sparse overview starts without scrolling').toBe(0)
    const listBounds = (await list.boundingBox())!
    for (const [description, item] of [
      ['Entire open-tab card', overview.locator('.tab-overview-card')],
      ['Recently closed entry', overview.locator('.recently-closed')],
    ] as const) {
      const bounds = (await item.boundingBox())!
      expect.soft(bounds.y, `${description} starts inside the results viewport without scrolling`).toBeGreaterThanOrEqual(listBounds.y)
      expect.soft(bounds.y + bounds.height, `${description} ends inside the results viewport without scrolling`).toBeLessThanOrEqual(listBounds.y + listBounds.height)
    }
    const panel = await overview.boundingBox()
    const footer = await overview.locator(':scope > footer').boundingBox()
    expect(panel).not.toBeNull()
    expect(footer).not.toBeNull()
    expect.soft(Math.abs(panel!.y + panel!.height - footer!.y - footer!.height), 'Footer must remain at the panel bottom even with one tab').toBeLessThanOrEqual(3)
    const colors = await colorCounts(appWindow, preview)
    for (const color of ['red', 'green', 'blue', 'yellow']) {
      expect.soft(colors[color], `${color} viewport corner must remain visible without cropping`).toBeGreaterThan(20)
    }
    await expect(overview.getByRole('searchbox', { name: 'Search tabs' })).toBeInViewport()
  } finally {
    await fixture.close()
  }
})

test('shows the entire tall page and lets users inspect its bottom at readable width', async ({ appWindow, electronApp }, testInfo) => {
  const fixture = await startDesignFixture()
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 1000))
    const tabId = await openFixture(appWindow, `${fixture.url}/tall`, 'Complete project plan')
    await appWindow.evaluate(`window.hronaut.setTabViewport(${JSON.stringify(tabId)}, { width: 900, height: 640, deviceScaleFactor: 2, mobile: false, touch: false, orientation: 'landscape' })`)
    const before = await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      await contents.executeJavaScript('scrollTo(0, 240)')
      return contents.executeJavaScript('({ width: innerWidth, height: innerHeight, scrollY, pixelRatio: devicePixelRatio })')
    }, `${fixture.url}/tall`)
    expect(before).toMatchObject({ width: 900, height: 640, scrollY: 240, pixelRatio: 2 })
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    const overview = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
    await overview.getByRole('button', { name: 'Preview Complete project plan', exact: true }).click()
    const details = overview.getByRole('region', { name: 'Page preview', exact: true })
    const image = details.getByRole('img', { name: 'Full-page preview of Complete project plan', exact: true })
    await expect(image).toBeVisible()
    const fitPage = details.getByRole('radio', { name: 'Fit page', exact: true })
    await fitPage.click()
    await fitPage.hover()
    expect(await controlContrast(fitPage), 'Selected Fit page text remains readable while hovered').toBeGreaterThanOrEqual(4.5)
    await expect(image).toBeInViewport({ ratio: 0.99 })
    const colors = await colorCounts(appWindow, image)
    expect(colors.magenta, 'Full-page capture includes the top milestone').toBeGreaterThan(20)
    expect(colors.cyan, 'Full-page capture includes the bottom milestone').toBeGreaterThan(20)
    const dimensions = await image.evaluate((element: HTMLImageElement) => ({ width: element.naturalWidth, height: element.naturalHeight }))
    expect(dimensions.height / dimensions.width).toBeGreaterThan(1.8)
    await appWindow.screenshot({ path: testInfo.outputPath('full-page-fit-page.png') })
    await details.getByRole('radio', { name: 'Fit width', exact: true }).click()
    const canvas = details.locator('.tab-page-preview-canvas')
    await expect.poll(() => canvas.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(500)
    const display = await image.boundingBox()
    const canvasBounds = await canvas.boundingBox()
    expect(display).not.toBeNull()
    expect(canvasBounds).not.toBeNull()
    expect(display!.width / canvasBounds!.width, 'Fit width makes the full capture readable at panel width').toBeGreaterThan(0.85)
    expect(display!.height / display!.width).toBeCloseTo(dimensions.height / dimensions.width, 1)
    await canvas.evaluate(element => { element.scrollTop = element.scrollHeight })
    const bottomColors = await colorCounts(appWindow, canvas)
    expect(bottomColors.cyan, 'Users can scroll to the final milestone').toBeGreaterThan(20)
    await appWindow.screenshot({ path: testInfo.outputPath('full-page-fit-width-bottom.png') })
    const after = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(candidate => candidate.getURL() === url)!.executeJavaScript('({ width: innerWidth, height: innerHeight, scrollY, pixelRatio: devicePixelRatio })'), `${fixture.url}/tall`)
    expect(after, 'Capturing and inspecting the page must preserve the actual tab viewport and scroll').toEqual(before)
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 520))
    await details.getByRole('radio', { name: 'Fit page', exact: true }).click()
    await expect(details.getByRole('button', { name: 'Back to tabs', exact: true })).toBeInViewport()
    await expect(details.getByRole('button', { name: 'Open tab', exact: true })).toBeInViewport()
    await expect(details.getByRole('radio', { name: 'Fit width', exact: true })).toBeInViewport()
    await expect(image).toBeInViewport({ ratio: 0.99 })
    await appWindow.screenshot({ path: testInfo.outputPath('full-page-narrow-fit-page.png') })
    await appWindow.evaluate("window.hronautSettings.setTheme('dark')")
    const fitWidth = details.getByRole('radio', { name: 'Fit width', exact: true })
    await fitWidth.click()
    await fitWidth.hover()
    expect(await controlContrast(fitWidth), 'Selected Fit width text remains readable while hovered in dark theme').toBeGreaterThanOrEqual(4.5)
    await canvas.evaluate(element => { element.scrollTop = element.scrollHeight })
    await appWindow.screenshot({ path: testInfo.outputPath('full-page-dark-fit-width-bottom.png') })
    await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1.25)')
    await details.getByRole('radio', { name: 'Fit page', exact: true }).click()
    await expect(details.getByRole('button', { name: 'Open tab', exact: true })).toBeInViewport()
    await expect(details.getByRole('button', { name: 'Refresh preview', exact: true })).toBeInViewport()
    await expect(image).toBeInViewport({ ratio: 0.99 })
    const scaledWindow = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
    await writeFile(testInfo.outputPath('full-page-dark-125-percent-scale.png'), Buffer.from(scaledWindow, 'base64'))
    await details.getByRole('button', { name: 'Back to tabs', exact: true }).click()
    await expect(details).toBeHidden()
    await expect(overview.getByRole('searchbox', { name: 'Search tabs' })).toBeVisible()
    // Review artifact only: a richer synthetic page makes the design easier to assess.
    await overview.getByRole('searchbox', { name: 'Search tabs' }).press('Escape')
    await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1)')
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 1000))
    await appWindow.evaluate(`window.hronaut.setTabViewport(${JSON.stringify(tabId)}, null)`)
    await appWindow.evaluate(`window.hronaut.navigate({ tabId: ${JSON.stringify(tabId)}, url: ${JSON.stringify(`${fixture.url}/workflow`)} })`)
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.title)`)).toBe('Release readiness')
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getTabOverviewPreviews([${JSON.stringify(tabId)}]).then(previews => previews.length)`)).toBe(1)
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    await expect(overview.locator('.tab-overview-preview > img')).toHaveAttribute('src', /^data:image/)
    await appWindow.screenshot({ path: testInfo.outputPath('demo-release-readiness-overview-dark.png') })
    await overview.getByRole('button', { name: 'Preview Release readiness', exact: true }).click()
    const demoImage = overview.getByRole('img', { name: 'Full-page preview of Release readiness', exact: true })
    await expect(demoImage).toBeVisible()
    await overview.getByRole('radio', { name: 'Fit width', exact: true }).click()
    await appWindow.screenshot({ path: testInfo.outputPath('demo-release-readiness-detail-dark.png') })
    await overview.getByRole('radio', { name: 'Fit page', exact: true }).click()
    await expect(demoImage).toBeInViewport({ ratio: 0.99 })
    await appWindow.screenshot({ path: testInfo.outputPath('demo-release-readiness-full-page-dark.png') })
  } finally {
    await fixture.close()
  }
})

test('keeps many-tab search and keyboard selection usable in narrow light and wide dark layouts', async ({ appWindow, electronApp }, testInfo) => {
  const fixture = await startDesignFixture()
  try {
    for (let index = 1; index <= 10; index++) {
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${fixture.url}/task-${index}`)}, active: ${index === 10} })`)
    }
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.filter(tab => tab.title.startsWith("Project task ")).length)')).toBe(10)
    await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => window.hronaut.getTabOverviewPreviews([state.activeTabId])).then(previews => previews.length)')).toBe(1)
    for (const [theme, width, height] of [['light', 760, 520], ['dark', 1900, 1100]] as const) {
      await appWindow.evaluate(`window.hronautSettings.setTheme(${JSON.stringify(theme)})`)
      await electronApp.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size.width, size.height), { width, height })
      const trigger = appWindow.getByRole('button', { name: 'Search tabs', exact: true })
      await trigger.click()
      const overview = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
      const search = overview.getByRole('searchbox', { name: 'Search tabs' })
      await expect(search).toBeFocused()
      await expect(overview.locator(':scope > footer')).toBeInViewport()
      expect(await overview.evaluate(element => element.scrollWidth <= element.clientWidth), 'Overview does not overflow horizontally').toBe(true)
      const activeTitle = await appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)') as string
      const activePreview = overview.locator('.tab-overview-card', { hasText: activeTitle }).locator('.tab-overview-preview')
      await expect(activePreview.locator('img')).toHaveAttribute('src', /^data:image/)
      await activePreview.scrollIntoViewIfNeeded()
      const activeColors = await colorCounts(appWindow, activePreview)
      for (const color of ['red', 'green', 'blue', 'yellow']) expect(activeColors[color], `${color} active-tab corner paints before design capture`).toBeGreaterThan(10)
      await appWindow.screenshot({ path: testInfo.outputPath(`many-tabs-${theme}-${width}.png`) })
      await search.fill('Project task 7')
      await expect(overview.locator('.tab-overview-card')).toHaveCount(1)
      await search.press('Enter')
      await expect(overview).toBeHidden()
      await expect.poll(() => appWindow.evaluate('window.hronaut.getState().then(state => state.tabs.find(tab => tab.active)?.title)')).toBe('Project task 7')
      await trigger.click()
      await search.press('Escape')
      await expect(overview).toBeHidden()
      await expect(trigger).toBeFocused()
    }
  } finally {
    await fixture.close()
  }
})


test('includes horizontal overflow and all document corners in a zoomed full-page preview', async ({ appWindow, electronApp }, testInfo) => {
  const fixture = await startDesignFixture()
  try {
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 1000))
    const tabId = await openFixture(appWindow, `${fixture.url}/wide`, 'Wide project board')
    await appWindow.evaluate(`window.hronaut.setZoom({ tabId: ${JSON.stringify(tabId)}, action: 'set', percent: 125 })`)
    const before = await electronApp.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      await contents.executeJavaScript('scrollTo(240, 180)')
      return contents.executeJavaScript('({ width: innerWidth, height: innerHeight, scrollX, scrollY, pixelRatio: devicePixelRatio, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight })')
    }, `${fixture.url}/wide`)
    expect(before).toMatchObject({ scrollX: 240, scrollY: 180, pixelRatio: 1.25, documentWidth: 2400, documentHeight: 1200 })
    await appWindow.getByRole('button', { name: 'Search tabs', exact: true }).click()
    const overview = appWindow.getByRole('dialog', { name: 'Tabs', exact: true })
    await overview.getByRole('button', { name: 'Preview Wide project board', exact: true }).click()
    const image = overview.getByRole('img', { name: 'Full-page preview of Wide project board', exact: true })
    await expect(image).toBeVisible()
    await overview.getByRole('radio', { name: 'Fit page', exact: true }).click()
    const colors = await colorCounts(appWindow, image)
    await appWindow.screenshot({ path: testInfo.outputPath('full-page-horizontal-overflow-125-percent-zoom.png') })
    console.log('Horizontal-overflow marker counts', colors)
    for (const color of ['red', 'green', 'blue', 'yellow']) {
      expect.soft(colors[color], `${color} document corner must survive capture beyond both viewport dimensions`).toBeGreaterThan(20)
    }
    const ratio = await image.evaluate((element: HTMLImageElement) => element.naturalWidth / element.naturalHeight)
    expect(ratio).toBeCloseTo(2, 1)
    const after = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
      .find(candidate => candidate.getURL() === url)!.executeJavaScript('({ width: innerWidth, height: innerHeight, scrollX, scrollY, pixelRatio: devicePixelRatio, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight })'), `${fixture.url}/wide`)
    expect(after).toEqual(before)
    await appWindow.screenshot({ path: testInfo.outputPath('full-page-horizontal-overflow-125-percent-zoom.png') })
  } finally {
    await fixture.close()
  }
})


test('preserves zoomed document corners within bounded MCP full-page screenshots', async ({ appWindow, electronApp, mcpPort, mcpToken }, testInfo) => {
  const fixture = await startDesignFixture()
  const client = new Client({ name: 'hronaut-synthetic-screenshot-zoom-test', version: '1.0.0' })
  const text = (result: CallToolResult): string => result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
  try {
    await expect.poll(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`, { headers: { authorization: `Bearer ${mcpToken}` } })).ok
      } catch { return false }
    }).toBe(true)
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
    }))
    await useMcpWorkspace(client, 'Synthetic screenshot zoom QA', false)
    const opened = await client.callTool({ name: 'browser_new_tab', arguments: { url: `${fixture.url}/wide`, active: true } }) as CallToolResult
    expect(opened.isError, text(opened)).not.toBe(true)
    const tabId = (JSON.parse(text(opened)) as { activeTabId: string }).activeTabId
    await expect.poll(() => appWindow.evaluate(`window.hronaut.getState().then(state => state.tabs.find(tab => tab.id === ${JSON.stringify(tabId)})?.title)`)).toBe('Wide project board')
    for (const scenario of [{ name: '125-percent-zoom', zoom: 125, pixelRatio: 1.25, viewport: null }, { name: 'dpr2', zoom: 100, pixelRatio: 2, viewport: { width: 900, height: 640, deviceScaleFactor: 2, mobile: false, touch: false, orientation: 'landscape' } }]) {
      await appWindow.evaluate(`window.hronaut.setTabViewport(${JSON.stringify(tabId)}, ${JSON.stringify(scenario.viewport)})`)
      const zoomed = await client.callTool({ name: 'browser_zoom', arguments: { tabId, action: 'set', percent: scenario.zoom } }) as CallToolResult
      expect(zoomed.isError, text(zoomed)).not.toBe(true)
      const before = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
        .find(candidate => candidate.getURL() === url)!.executeJavaScript('({ width: innerWidth, height: innerHeight, scrollX, scrollY, pixelRatio: devicePixelRatio })'), `${fixture.url}/wide`)
      expect(before).toMatchObject({ pixelRatio: scenario.pixelRatio })
      const screenshot = await client.callTool({ name: 'browser_screenshot', arguments: { tabId, fullPage: true, maxWidth: 1200, maxHeight: 1200 } }) as CallToolResult
      expect(screenshot.isError, text(screenshot)).not.toBe(true)
      const image = screenshot.content.find(item => item.type === 'image')
      expect(image?.type).toBe('image')
      if (image?.type !== 'image') throw new Error('Screenshot returned no image')
      const png = Buffer.from(image.data, 'base64')
      await writeFile(testInfo.outputPath(`mcp-bounded-full-page-${scenario.name}.png`), png)
      const dimensions = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
      expect.soft(dimensions.width, 'MCP screenshot respects maximum width at native zoom').toBeLessThanOrEqual(1200)
      expect.soft(dimensions.height, 'MCP screenshot respects maximum height at native zoom').toBeLessThanOrEqual(1200)
      const colors = await imageColorCounts(appWindow, image.data)
      for (const color of ['red', 'green', 'blue', 'yellow']) expect.soft(colors[color], `${color} document corner survives bounded MCP screenshot under ${scenario.name}`).toBeGreaterThan(20)
      const after = await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents()
        .find(candidate => candidate.getURL() === url)!.executeJavaScript('({ width: innerWidth, height: innerHeight, scrollX, scrollY, pixelRatio: devicePixelRatio })'), `${fixture.url}/wide`)
      expect(after).toEqual(before)
    }
  } finally {
    await client.close()
    await fixture.close()
  }
})
