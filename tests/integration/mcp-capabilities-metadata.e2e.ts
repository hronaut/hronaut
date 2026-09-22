import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test, text } from './capability-fixtures.js'

test('reports design, metadata and connection security without private content', async ({ capabilities, appWindow }) => {
  const { client, tabId, address, openPageTool } = capabilities
  const designResult = await client.callTool({
    name: 'browser_design_overview',
    arguments: { tabId }
  }) as CallToolResult
  expect(designResult.isError, text(designResult)).not.toBe(true)
  const designReport = JSON.parse(text(designResult))
  expect(designReport).toMatchObject({
    tabId,
    summary: {
      visibleElements: expect.any(Number),
      textColorCount: expect.any(Number),
      fontCombinationCount: expect.any(Number),
      contrastIssueCount: expect.any(Number)
    },
    colors: { text: expect.any(Array), background: expect.any(Array), border: expect.any(Array) },
    fonts: expect.any(Array),
    mediaQueries: expect.arrayContaining([expect.objectContaining({ query: '(max-width: 900px)' })]),
    caveats: expect.arrayContaining([expect.stringContaining('bounded current-rendering sample')])
  })
  expect(designReport.summary.visibleElements).toBeGreaterThan(0)
  expect(designReport.summary.contrastIssueCount).toBeGreaterThan(0)
  expect(designReport.contrastIssues.length).toBeGreaterThan(0)
  expect(JSON.stringify(designReport)).not.toContain('design-overview-secret-body-copy')
  expect(JSON.stringify(designReport)).not.toContain('contrast-probe')

  await openPageTool(/Design overview:/)
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const designPanel = appWindow.getByRole('dialog', { name: 'Огляд дизайну' })
  await expect(designPanel).toBeVisible()
  await expect(designPanel).toContainText('Обчислені кольори')
  await expect(designPanel).toContainText('Типографіка')
  await expect(designPanel).toContainText('Ймовірні проблеми контрасту тексту')
  await designPanel.getByRole('button', { name: 'Закрити огляд дизайну' }).click()
  await expect(designPanel).toBeHidden()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

  const metadataResult = await client.callTool({
    name: 'browser_page_metadata',
    arguments: { tabId }
  }) as CallToolResult
  expect(metadataResult.isError, text(metadataResult)).not.toBe(true)
  const metadataReport = JSON.parse(text(metadataResult))
  expect(metadataReport).toMatchObject({
    tabId,
    title: 'Capability fixture',
    document: {
      language: 'en',
      description: 'Capability metadata description',
      titleElementCount: 1,
      descriptionCount: 1,
      headingCounts: { h1: 1 }
    },
    openGraph: {
      title: 'Capability social title',
      type: 'website',
      images: [expect.objectContaining({ alt: 'Capability social image' })]
    },
    twitter: { card: 'summary_large_image', title: 'Capability Twitter title' },
    alternateLinks: [expect.objectContaining({ language: 'uk' })],
    structuredData: {
      blockCount: 1,
      validBlockCount: 1,
      invalidBlockCount: 0,
      types: expect.arrayContaining(['WebPage', 'SoftwareApplication'])
    }
  })
  expect(metadataReport.document.canonicalUrls[0]).toContain('token=%5BREDACTED%5D')
  const serializedMetadata = JSON.stringify(metadataReport)
  expect(serializedMetadata).not.toContain('page-metadata-secret-meta')
  expect(serializedMetadata).not.toContain('page-metadata-secret-url')
  expect(serializedMetadata).not.toContain('page-metadata-secret-icon')
  expect(serializedMetadata).not.toContain('page-metadata-secret-og-url')
  expect(serializedMetadata).not.toContain('page-metadata-secret-image')
  expect(serializedMetadata).not.toContain('page-metadata-secret-structured-value')
  expect(serializedMetadata).not.toContain('design-overview-secret-body-copy')

  await openPageTool(/Page metadata:/)
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const metadataPanel = appWindow.getByRole('dialog', { name: 'Метадані сторінки' })
  await expect(metadataPanel).toBeVisible()
  await expect(metadataPanel).toContainText('Дані для результату пошуку')
  await expect(metadataPanel).toContainText('Соціальні картки')
  await expect(metadataPanel).toContainText('WebPage')
  await metadataPanel.getByRole('button', { name: 'Закрити метадані сторінки' }).click()
  await expect(metadataPanel).toBeHidden()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")

  const securityResult = await client.callTool({
    name: 'browser_security',
    arguments: { tabId }
  }) as CallToolResult
  expect(securityResult.isError, text(securityResult)).not.toBe(true)
  const securityReport = JSON.parse(text(securityResult))
  expect(securityReport).toMatchObject({
    tabId,
    origin: `http://127.0.0.1:${address.port}`,
    secureTransport: false,
    caveats: expect.arrayContaining([expect.stringContaining('main document')])
  })
  expect(['insecure', 'neutral']).toContain(securityReport.state)
  expect(JSON.stringify(securityReport)).not.toContain('response-secret')

  await openPageTool(/Security:/)
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('uk-UA')")
  const securityPanel = appWindow.getByRole('dialog', { name: 'Безпека з’єднання' })
  await expect(securityPanel).toBeVisible()
  await expect(securityPanel).toContainText('Зашифрований транспорт')
  await expect(securityPanel).toContainText('Відомості сертифіката TLS недоступні')
  await securityPanel.getByRole('button', { name: 'Закрити звіт безпеки' }).click()
  await expect(securityPanel).toBeHidden()
  await appWindow.evaluate("window.hronautSettings.setLanguagePreference('en-US')")
})
