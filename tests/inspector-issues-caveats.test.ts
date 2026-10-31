import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ publishChange: vi.fn() }))
vi.mock('../src/main/browser/website-dialogs/website-dialogs.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/website-dialogs/website-dialogs.js')>(),
  ensureDialogMonitoring: vi.fn()
}))
import { addInspectorIssue, inspectorIssues } from '../src/main/browser/inspector-issues/inspector-issues.js'
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
  expect(caveat).toContain('own origin, Hronaut may ask the person to sign in with its own dialog')
  expect(caveat).toContain('Agents never see what the person types and cannot answer the dialog')
  expect(caveat).not.toContain('cancelled without supplying credentials')
})

// While a website dialog held the page, the form check waited for the page, so the agent's issues tool never answered.
function pageWithForms(dialog?: { type: 'alert', message: string, url: string }) {
  const formIssue = { formLabelErrorType: 'FormLabelForNameError', violatingNodeId: 4 }
  const pageDebugger = Object.assign(new EventEmitter(), {
    isAttached: () => true,
    sendCommand: vi.fn(async (): Promise<unknown> => ({ formIssues: [formIssue] }))
  })
  const tab = {
    id: 'tab-1',
    title: 'Example',
    url: 'https://example.test/',
    sleeping: false,
    webContents: { isDevToolsOpened: () => false, debugger: pageDebugger } as unknown as WebContents,
    dialog,
    inspectorIssues: [],
    inspectorIssuesTruncated: false,
    authChallenges: [],
    authChallengesTruncated: false,
    authNavigationPending: false
  }
  const browser = { tabs: new Map([[tab.id, tab]]), activeTabId: tab.id } as unknown as Browser
  return { tab, browser, pageDebugger }
}
const formsNotChecked = 'A website dialog holds the page, so its forms were not checked; answer it with browser_dialog and call browser_issues again.'

it('checks the page\'s forms when no website dialog holds it', async () => {
  const { tab, browser, pageDebugger } = pageWithForms()
  const report = await inspectorIssues(browser, tab.id)
  expect(pageDebugger.sendCommand).toHaveBeenCalledWith('Audits.checkFormsIssues')
  expect(report.issues).toHaveLength(1)
  expect(report.caveats).not.toContain(formsNotChecked)
})

it('lists the issues of a page a website dialog holds without checking its forms', async () => {
  const { tab, browser, pageDebugger } = pageWithForms({ type: 'alert', message: 'Unsaved draft', url: 'https://example.test/' })
  addInspectorIssue(browser, tab as never, { code: 'GenericIssue', details: { genericIssueDetails: { errorType: 'CrossOriginPortalPostMessageError' } } }, false)
  const report = await inspectorIssues(browser, tab.id)
  expect(pageDebugger.sendCommand).not.toHaveBeenCalled()
  expect(report.issues).toHaveLength(1)
  expect(report.caveats).toContain(formsNotChecked)
})

it('stops waiting for the form check when a website dialog opens meanwhile', async () => {
  const { tab, browser, pageDebugger } = pageWithForms()
  pageDebugger.sendCommand.mockImplementationOnce(() => new Promise(() => undefined))
  const reporting = inspectorIssues(browser, tab.id)
  await vi.waitFor(() => expect(pageDebugger.sendCommand).toHaveBeenCalled())
  pageDebugger.emit('message', {}, 'Page.javascriptDialogOpening', { type: 'alert' })
  const report = await reporting
  expect(report.issues).toEqual([])
  expect(report.caveats).toContain(formsNotChecked)
  expect(pageDebugger.listenerCount('message')).toBe(0)
})
