import type { WebContents } from 'electron'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ publishChange: vi.fn() }))
vi.mock('../src/main/browser/website-dialogs/website-dialogs.js', () => ({ ensureDialogMonitoring: vi.fn() }))
import { inspectorIssues } from '../src/main/browser/inspector-issues/inspector-issues.js'
import type { Browser } from '../src/main/browser/browser.js'

it('tells agents that Hronaut may ask the person to sign in for the HTTP Basic challenges it lists, not that it cancels them all', async () => {
  const tab = {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    sleeping: false,
    // Developer Tools owns the tab, so the report reads only what the tab keeps.
    webContents: { isDevToolsOpened: () => true } as unknown as WebContents,
    inspectorIssues: [],
    inspectorIssuesTruncated: false,
    authChallenges: [{ observedAt: '2026-10-30T09:00:00.000Z', scheme: 'basic' as const, origin: 'https://example.test', request: 'main-frame-navigation' as const }],
    authChallengesTruncated: false,
    authNavigationPending: false
  }
  const browser = { tabs: new Map([[tab.id, tab]]), activeTabId: tab.id } as unknown as Browser

  const report = await inspectorIssues(browser, tab.id)

  expect(report.authChallenges).toEqual(tab.authChallenges)
  const caveat = report.caveats.find((text) => text.startsWith('authChallenges '))
  expect(caveat).toContain('Hronaut may ask the person to sign in in its own dialog')
  expect(caveat).toContain('Agents never see or supply credentials')
  expect(caveat).not.toContain('cancelled without supplying credentials')
})
