import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('exports bounded screenshots and PDFs and records downloads and activity', async ({ capabilities, electronApp, appWindow, profileDirectory }) => {
  const { client, tabId, address, openPageTool } = capabilities
  await client.callTool({
    name: 'browser_evaluate',
    arguments: { tabId, script: 'document.title' }
  })
  const commandedTab = appWindow.locator('.tab.active')
  await expect(commandedTab).toHaveClass(/mcp-active/)
  await expect(commandedTab).toHaveAttribute('aria-description', 'Agent active')
  await expect(commandedTab).not.toHaveClass(/mcp-active/, { timeout: 3_000 })

  await openPageTool('Save page as PDF')
  await expect(appWindow.getByRole('status', { name: 'Save as PDF' })).toContainText('PDF saved to')
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const pageToolsAfterPdf = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(pageToolsAfterPdf.getByRole('button', { name: /PDF saved to/ })).toBeVisible()
  await pageToolsAfterPdf.getByRole('button', { name: 'Close page tools' }).click()
  const humanPdf = await readFile(join(profileDirectory, 'Capability fixture.pdf'))
  expect(humanPdf.subarray(0, 5).toString()).toBe('%PDF-')

  const pdfIsolationTabResult = await client.callTool({
    name: 'browser_new_tab',
    arguments: { url: `http://127.0.0.1:${address.port}/`, active: true }
  }) as CallToolResult
  expect(pdfIsolationTabResult.isError, text(pdfIsolationTabResult)).not.toBe(true)
  const pdfIsolationTabId = JSON.parse(text(pdfIsolationTabResult)).activeTabId as string
  await appWindow.getByRole('button', { name: 'Page tools' }).click()
  const isolatedPdfPageTools = appWindow.getByRole('dialog', { name: 'Page tools' })
  await expect(isolatedPdfPageTools.getByRole('button', { name: 'Save page as PDF', exact: true })).toBeVisible()
  await expect(isolatedPdfPageTools).not.toContainText('PDF saved to')
  await isolatedPdfPageTools.getByRole('button', { name: 'Close page tools' }).click()
  await client.callTool({ name: 'browser_close_tab', arguments: { tabId: pdfIsolationTabId } })
  await client.callTool({ name: 'browser_select_tab', arguments: { tabId } })

  const screenshot = await client.callTool({
    name: 'browser_screenshot',
    arguments: { tabId, fullPage: true }
  }) as CallToolResult
  const image = screenshot.content.find((item) => item.type === 'image')
  expect(image?.type).toBe('image')
  if (image?.type === 'image') expect(image.data.startsWith('iVBOR')).toBe(true)

  const captureSnapshot = await client.callTool({ name: 'browser_snapshot', arguments: { tabId } }) as CallToolResult
  const captureRef = text(captureSnapshot).match(/\[(e\d+)\] button "Capture this area"/)?.[1]
  if (!captureRef) throw new Error('Targeted screenshot fixture did not receive a snapshot ref')
  const elementScreenshot = await client.callTool({
    name: 'browser_screenshot',
    arguments: { tabId, ref: captureRef }
  }) as CallToolResult
  const elementImage = elementScreenshot.content.find((item) => item.type === 'image')
  expect(elementImage).toMatchObject({ type: 'image', mimeType: 'image/png' })
  if (elementImage?.type === 'image') {
    const png = Buffer.from(elementImage.data, 'base64')
    expect(png.readUInt32BE(16)).toBe(240)
    expect(png.readUInt32BE(20)).toBe(120)
  }
  const regionScreenshot = await client.callTool({
    name: 'browser_screenshot',
    arguments: { tabId, clip: { x: 10, y: 10, width: 160, height: 90 } }
  }) as CallToolResult
  const regionImage = regionScreenshot.content.find((item) => item.type === 'image')
  expect(regionImage).toMatchObject({ type: 'image', mimeType: 'image/png' })
  if (regionImage?.type === 'image') {
    const png = Buffer.from(regionImage.data, 'base64')
    expect(png.readUInt32BE(16)).toBe(160)
    expect(png.readUInt32BE(20)).toBe(90)
  }
  const boundedElementScreenshot = await client.callTool({
    name: 'browser_screenshot',
    arguments: { tabId, selector: '#capture-target', maxWidth: 120 }
  }) as CallToolResult
  const boundedElementImage = boundedElementScreenshot.content.find((item) => item.type === 'image')
  if (boundedElementImage?.type === 'image') {
    const png = Buffer.from(boundedElementImage.data, 'base64')
    expect(png.readUInt32BE(16)).toBe(120)
    expect(png.readUInt32BE(20)).toBe(60)
  }
  const invalidScreenshotScope = await client.callTool({
    name: 'browser_screenshot',
    arguments: { tabId, fullPage: true, selector: '#capture-target' }
  }) as CallToolResult
  expect(invalidScreenshotScope.isError).toBe(true)
  expect(text(invalidScreenshotScope)).toContain('fullPage cannot be combined')

  const firstPdf = await client.callTool({
    name: 'browser_pdf_save',
    arguments: { tabId, filename: 'capability-report.pdf', pageSize: 'A4' }
  }) as CallToolResult
  expect(firstPdf.isError, text(firstPdf)).not.toBe(true)
  const firstPdfResult = JSON.parse(text(firstPdf)) as { filename: string; path: string; bytes: number }
  expect(firstPdfResult).toMatchObject({
    filename: 'capability-report.pdf',
    path: join(profileDirectory, 'capability-report.pdf'),
    bytes: expect.any(Number)
  })
  expect((await readFile(firstPdfResult.path)).subarray(0, 5).toString()).toBe('%PDF-')

  const secondPdf = await client.callTool({
    name: 'browser_pdf_save',
    arguments: { tabId, filename: 'capability-report.pdf', landscape: true }
  }) as CallToolResult
  expect(JSON.parse(text(secondPdf))).toMatchObject({
    filename: 'capability-report (1).pdf',
    path: join(profileDirectory, 'capability-report (1).pdf')
  })
  const invalidPdf = await client.callTool({
    name: 'browser_pdf_save',
    arguments: { tabId, filename: '../outside.pdf' }
  }) as CallToolResult
  expect(invalidPdf.isError).toBe(true)
  expect(text(invalidPdf)).toContain('without a directory path')
  for (const filename of ['CON.pdf', 'nul', 'COM1.report.pdf', 'LPT³.pdf']) {
    const reservedPdf = await client.callTool({
      name: 'browser_pdf_save',
      arguments: { tabId, filename }
    }) as CallToolResult
    expect(reservedPdf.isError, `${filename}: ${text(reservedPdf)}`).toBe(true)
    expect(text(reservedPdf)).toContain('portable file name')
  }

  await client.callTool({ name: 'browser_click', arguments: { tabId, selector: '#download' } })
  await expect
    .poll(async () => {
      const result = await client.callTool({ name: 'browser_downloads', arguments: {} }) as CallToolResult
      return JSON.parse(text(result)) as Array<{ state: string; filename: string; savePath?: string }>
    })
    .toEqual([
      expect.objectContaining({
        state: 'completed',
        filename: 'capability.txt',
        savePath: join(profileDirectory, 'capability.txt')
      })
    ])

  const activity = await electronApp.evaluate(async ({ webContents }) => {
    const home = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith('hronaut://home'))
    if (!home) throw new Error('Hronaut Home was not found')
    return home.executeJavaScript(`fetch('/api/status').then((response) => response.json())`)
  }) as {
    completedToolCalls: number
    recentActivity: Array<{ toolName: string; outcome: string; durationMs: number }>
    toolMetrics: Array<{ toolName: string; count: number }>
  }
  expect(activity.completedToolCalls).toBeGreaterThan(10)
  expect(activity.recentActivity).toEqual(expect.arrayContaining([
    expect.objectContaining({ toolName: 'browser_screenshot', outcome: 'finished' })
  ]))
  expect(activity.recentActivity.every((entry) => entry.durationMs >= 0)).toBe(true)
  expect(activity.toolMetrics).toEqual(expect.arrayContaining([
    expect.objectContaining({ toolName: 'browser_evaluate', count: expect.any(Number) })
  ]))
})
