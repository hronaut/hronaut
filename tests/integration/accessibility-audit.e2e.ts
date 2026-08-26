import axe from 'axe-core'
import { expect, test } from './fixtures.js'
import { RESOLVED_THEME_NAMES } from '../../src/shared/theme.js'

interface AxeFinding {
  id: string
  impact: string | null
  description: string
  nodes: Array<{ target: string[]; html: string; failureSummary: string | undefined }>
}

async function auditShell(appWindow: import('@playwright/test').Page): Promise<AxeFinding[]> {
  await appWindow.evaluate(axe.source)
  return appWindow.evaluate(`(async () => {
    const wcagResults = await globalThis.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }
    })
    const landmarkResults = await globalThis.axe.run(document, {
      runOnly: { type: 'rule', values: ['landmark-main-is-top-level'] }
    })
    return [...wcagResults.violations, ...landmarkResults.violations].map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      description: violation.description,
      nodes: violation.nodes.map((node) => ({
        target: node.target,
        html: node.html,
        failureSummary: node.failureSummary
      }))
    }))
  })()`)
}

test('keeps primary shell states free of accessibility violations', async ({ appWindow }) => {
  await appWindow.evaluate(`window.hronautSettings.setTheme('light')`)
  await expect(appWindow.locator('html')).toHaveAttribute('data-theme', 'light')

  const findings: Record<string, AxeFinding[]> = {}
  findings.home = await auditShell(appWindow)

  await appWindow.evaluate(`window.hronaut.newTab({
    url: 'data:text/html,<title>Accessibility fixture</title><main>Fixture</main>',
    active: true
  })`)
  findings.website = await auditShell(appWindow)

  await appWindow.getByRole('button', { name: 'Settings' }).click()
  findings.settings = await auditShell(appWindow)

  expect(findings).toEqual({ home: [], website: [], settings: [] })
})

test('keeps every theme picker free of color contrast violations', async ({ appWindow }) => {
  await appWindow.getByRole('button', { name: 'Settings' }).click()
  const findings: Record<string, AxeFinding[]> = {}

  for (const theme of RESOLVED_THEME_NAMES) {
    await appWindow.getByTestId(`theme-${theme}`).click()
    await expect(appWindow.locator('html')).toHaveAttribute('data-theme', theme)
    findings[theme] = (await auditShell(appWindow)).filter((finding) => finding.id === 'color-contrast')
  }

  expect(findings).toEqual(Object.fromEntries(RESOLVED_THEME_NAMES.map((theme) => [theme, []])))
})
