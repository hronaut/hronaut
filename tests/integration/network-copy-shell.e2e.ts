import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { writeFile } from 'node:fs/promises'
import { localeMessages, translate } from '../../src/shared/i18n.js'
import type { SupportedLocale } from '../../src/shared/locale.js'
import { expect, test, text } from './capability-fixtures.js'

type ClipboardScope = typeof globalThis & { restoreShellCopyClipboard?: () => void }

test('Network cURL and PowerShell copy labels remain accessible in every locale and only confirm verified copies', async ({ capabilities, appWindow, electronApp }, info) => {
  const { client, tabId, openPageTool } = capabilities
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return text(result)
  }
  await call('browser_network')
  await call('browser_evaluate', { script: "fetch('/api-details?fixture=copy-shell', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: 'shell-copy' }) }).then(r=>r.text()).then(()=>true)" })
  let requestId: string | undefined
  await expect.poll(async () => {
    const records = JSON.parse(await call('browser_network')) as Array<{ id: string; url: string; completedAt?: string }>
    requestId = records.find(row => row.url.includes('fixture=copy-shell') && row.completedAt)?.id
    return requestId
  }).toBeTruthy()
  const expected = await call('browser_network_request', { requestId, copyAs: 'curl' })
  const expectedPowerShell = await call('browser_network_request', { requestId, copyAs: 'powershell' })
  expect(expectedPowerShell).toContain('Invoke-WebRequest -UseBasicParsing')
  await openPageTool('Open network monitor')
  const panel = appWindow.locator('.network-monitor-panel')
  await panel.getByRole('searchbox', { name: 'Filter network requests', exact: true }).fill('fixture=copy-shell')
  const rows = panel.getByRole('listbox', { name: 'Network requests' }).getByRole('option')
  await expect(rows).toHaveCount(1)
  await rows.first().click()
  const selectedUrl = await panel.locator('.network-detail-url').innerText()
  // Keep the minimum width with enough height for the retained request tools.
  // The pre-existing 760x520/125% layout can leave no usable request body area.
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(760, 900))
  await appWindow.evaluate('window.hronautSettings.setInterfaceScale(1.25)')
  for (const locale of Object.keys(localeMessages) as SupportedLocale[]) {
    await appWindow.evaluate(locale => (window as unknown as { hronautSettings: { setLanguagePreference(locale: string): Promise<unknown> } }).hronautSettings.setLanguagePreference(locale), locale)
    // A different verified copy clears the previous cURL confirmation without a timer wait.
    await panel.getByRole('button', { name: translate(locale, 'network.details.copyJson'), exact: true }).click()
    await expect(panel.getByRole('button', { name: translate(locale, 'network.details.copiedJson'), exact: true })).toBeVisible()
    const copy = panel.getByRole('button', { name: translate(locale, 'network.details.copyCurl'), exact: true })
    await copy.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
    if (locale === 'de-DE' || locale === 'ru-RU') {
      const capture = await electronApp.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString('base64'))
      await writeFile(info.outputPath(`copy-layout-${locale}.png`), Buffer.from(capture, 'base64'))
    }
    await expect(copy).toBeInViewport({ ratio: 1 })
    const bounds = (await panel.boundingBox())!
    const button = (await copy.boundingBox())!
    expect(button.x).toBeGreaterThanOrEqual(bounds.x)
    expect(button.x + button.width).toBeLessThanOrEqual(bounds.x + bounds.width)
    expect(await copy.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await copy.focus()
    await expect(copy).toBeFocused()
    await copy.press('Enter')
    const copied = panel.getByRole('button', { name: translate(locale, 'network.details.copiedCurl'), exact: true })
    await expect(copied).toBeVisible()
    await expect(copied).toBeInViewport({ ratio: 1 })
    await expect(copied).toBeFocused()
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(expected)
    await expect(panel.locator('.network-detail-url')).toHaveText(selectedUrl)
    await expect(panel).toContainText(translate(locale, 'network.details.reviewCommands'))
    const copyPowerShell = panel.getByRole('button', { name: translate(locale, 'network.details.copyPowerShell'), exact: true })
    await copyPowerShell.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest' }))
    await expect(copyPowerShell).toBeInViewport({ ratio: 1 })
    const powerShellButton = (await copyPowerShell.boundingBox())!
    expect(powerShellButton.x + powerShellButton.width).toBeLessThanOrEqual(bounds.x + bounds.width)
    expect(await copyPowerShell.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await copyPowerShell.click()
    await expect(panel.getByRole('button', { name: translate(locale, 'network.details.copiedPowerShell'), exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: translate(locale, 'network.details.copiedCurl'), exact: true })).toHaveCount(0)
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe(expectedPowerShell)
  }
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")
  await electronApp.evaluate(({ clipboard }) => {
    const original = clipboard.writeText
    ;(globalThis as ClipboardScope).restoreShellCopyClipboard = () => { clipboard.writeText = original }
    clipboard.writeText = async () => { throw new Error('Rejected POSIX copy write') }
  })
  try {
    await panel.getByRole('button', { name: /^(Copy sanitized cURL|Copied cURL) \(POSIX shell\)$/ }).click()
    await expect(appWindow.locator('.app-toast').filter({ hasText: 'Rejected POSIX copy write' })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Copied cURL (POSIX shell)', exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Copy sanitized cURL (POSIX shell)', exact: true })).toBeVisible()
  } finally {
    await electronApp.evaluate(() => { (globalThis as ClipboardScope).restoreShellCopyClipboard?.(); delete (globalThis as ClipboardScope).restoreShellCopyClipboard })
  }
})
