import { createServer } from 'node:http'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserInspectorIssuesReport, HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer } from './fixtures.js'
import { expect, test, text } from './capability-fixtures.js'

for (const mode of ['enforce', 'report-only', 'mixed'] as const) {
  test(`CSP ${mode} native evidence agrees with MCP, Issues and copied JSON`, async ({ capabilities, electronApp, appWindow }) => {
    const { client, tabId, fixtureUrl, openPageTool } = capabilities
    const server = createServer((request, response) => {
      if (request.url !== '/') { response.end(''); return }
      const policy = "script-src 'none'; style-src 'none'; img-src 'none'; report-uri /report"
      if (mode !== 'report-only') response.setHeader('Content-Security-Policy', policy)
      if (mode !== 'enforce') response.setHeader('Content-Security-Policy-Report-Only', policy)
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>CSP fixture</title><script>window.fixtureMarker=true</script><style>body{color:red}</style><img src="/image.png?token=fixture-secret">')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address() as { port: number }
    let contentsId: number | undefined
    try {
      // Observe the already owned debugger without attaching, enabling or replacing it.
      contentsId = await electronApp.evaluate(({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)
        if (!contents || !contents.debugger.isAttached()) throw new Error('Fixture debugger unavailable')
        type Evidence = { isReportOnly: unknown; directive: unknown; kind: unknown }
        const state = globalThis as typeof globalThis & { cspEvidence?: Evidence[]; cspListener?: (...args: unknown[]) => void }
        state.cspEvidence = []
        state.cspListener = (_event, method, params) => {
          if (method !== 'Audits.issueAdded') return
          const issue = (params as { issue: { code: string; details: { contentSecurityPolicyIssueDetails?: Record<string, unknown> } } }).issue
          if (issue.code !== 'ContentSecurityPolicyIssue') return
          const details = issue.details.contentSecurityPolicyIssueDetails!
          state.cspEvidence!.push({ isReportOnly: details.isReportOnly, directive: details.violatedDirective, kind: details.contentSecurityPolicyViolationType })
        }
        contents.debugger.on('message', state.cspListener)
        return contents.id
      }, fixtureUrl)
      const observedContentsId = contentsId
      const list = async (): Promise<BrowserInspectorIssuesReport> => {
        const result = await client.callTool({ name: 'browser_issues', arguments: { tabId, action: 'list' } }) as CallToolResult
        expect(result.isError, text(result)).not.toBe(true)
        return JSON.parse(text(result)) as BrowserInspectorIssuesReport
      }
      const navigated = await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `http://127.0.0.1:${address.port}/` } }) as CallToolResult
      expect(navigated.isError, text(navigated)).not.toBe(true)
      const modes = mode === 'mixed' ? ['enforce', 'report-only'] : [mode]
      const expected = modes.flatMap((disposition) => ['script-src-elem', 'style-src-elem', 'img-src'].map((directive) => ({
        isReportOnly: disposition === 'report-only', directive, kind: directive === 'img-src' ? 'kURLViolation' : 'kInlineViolation'
      })))
      await expect.poll(() => electronApp.evaluate(() => (globalThis as typeof globalThis & { cspEvidence?: unknown[] }).cspEvidence)).toEqual(expect.arrayContaining(expected))
      await expect.poll(async () => (await list()).issues.filter((issue) => issue.code === 'ContentSecurityPolicyIssue').length).toBe(expected.length)
      const report = await list()
      const issues = report.issues.filter((issue) => issue.code === 'ContentSecurityPolicyIssue')
      for (const native of expected) {
        expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({
          cspDisposition: native.isReportOnly ? 'report-only' : 'enforce', severity: 'error', reasons: expect.arrayContaining([native.directive, native.kind])
        })]))
      }
      expect(new Set(issues.map((issue) => issue.id)).size).toBe(expected.length)
      expect(report.errorCount).toBe(expected.length)
      expect(JSON.stringify(report)).not.toContain('fixture-secret')
      expect(JSON.stringify(report)).not.toContain('fixtureMarker')
      await openPageTool(/Open browser issues:/)
      const panel = appWindow.getByRole('dialog', { name: 'Issues' })
      for (const disposition of modes) await expect(panel.getByText(disposition === 'enforce' ? 'CSP: enforced' : 'CSP: report-only', { exact: true })).toHaveCount(3)
      await panel.getByRole('button', { name: 'Copy issues' }).click()
      await expect(panel.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
      const copied = JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())) as BrowserInspectorIssuesReport
      expect(copied.issues).toEqual(report.issues)
      await panel.getByRole('button', { name: 'Clear', exact: true }).click()
      await expect(panel).toContainText('No browser issues captured')
      expect((await list()).issues).toEqual([])
      await panel.getByRole('button', { name: 'Close browser issues' }).click()
      await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureUrl } })
      expect((await list()).issues.filter((issue) => issue.code === 'ContentSecurityPolicyIssue')).toEqual([])
      if (mode === 'mixed') {
        await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.openDevTools({ mode: 'detach', activate: false }), observedContentsId)
        try {
          await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.isDevToolsOpened(), observedContentsId)).toBe(true)
          expect((await list()).devToolsOpen).toBe(true)
          expect(await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.isDevToolsOpened(), observedContentsId)).toBe(true)
        } finally {
          await electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.closeDevTools(), observedContentsId)
        }
        await expect.poll(() => electronApp.evaluate(({ webContents }, id) => webContents.fromId(id)!.isDevToolsOpened(), observedContentsId)).toBe(false)
        expect((await list()).devToolsOpen).toBe(false)
        await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `http://127.0.0.1:${address.port}/` } })
        await expect.poll(async () => (await list()).issues.filter((issue) => issue.code === 'ContentSecurityPolicyIssue').map((issue) => issue.cspDisposition).sort()).toEqual(['enforce', 'enforce', 'enforce', 'report-only', 'report-only', 'report-only'])
      }
    } finally {
      try {
        if (contentsId !== undefined) await electronApp.evaluate(({ webContents }, id) => {
          const state = globalThis as typeof globalThis & { cspEvidence?: unknown[]; cspListener?: (...args: unknown[]) => void }
          if (state.cspListener) webContents.fromId(id)?.debugger.removeListener('message', state.cspListener)
          delete state.cspListener
          delete state.cspEvidence
        }, contentsId)
      } finally {
        await closeFixtureServer(server)
      }
    }
  })
}

test('CSP normalized retention, native-ID authority, unknown UI and access boundaries', async ({ capabilities, electronApp, appWindow }) => {
  const { client, tabId, fixtureUrl, workspace, openPageTool } = capabilities
  const call = async (action = 'list', id = tabId) => client.callTool({ name: 'browser_issues', arguments: { tabId: id, action } }) as Promise<CallToolResult>
  await call('clear')
  // Deterministic protocol-event injection tests retention and malformed/native-ID
  // contracts; the header-policy cases above establish actual Chromium evidence.
  const emit = async (entries: Array<{ flag?: unknown; id?: string; directive?: string }>) => electronApp.evaluate(({ webContents }, { url, entries }) => {
    const contents = webContents.getAllWebContents().find((candidate) => candidate.getURL() === url)!
    for (const entry of entries) contents.debugger.emit('message', {}, 'Audits.issueAdded', {
      issue: { code: 'ContentSecurityPolicyIssue', issueId: entry.id, details: { contentSecurityPolicyIssueDetails: { isReportOnly: entry.flag, violatedDirective: entry.directive ?? 'script-src-elem' } } }
    })
  }, { url: fixtureUrl, entries })
  await emit([{ flag: true }, { flag: true }, { flag: false }, { flag: null }, { flag: 'false' }, { id: 'native', flag: true }, { id: 'native', flag: false }])
  let report = JSON.parse(text(await call())) as BrowserInspectorIssuesReport
  expect(report.issueCount).toBe(4)
  expect(report.issues.map((issue) => issue.cspDisposition)).toEqual(['report-only', 'enforce', 'unknown', 'report-only'])
  expect(report.issues.find((issue) => issue.id === 'native')?.cspDisposition).toBe('report-only')
  await openPageTool(/Open browser issues:/)
  const panel = appWindow.getByRole('dialog', { name: 'Issues' })
  await expect(panel.getByText('CSP: enforcement unknown', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Copy issues' }).click()
  await expect(panel.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  expect((JSON.parse(await electronApp.evaluate(({ clipboard }) => clipboard.readText())) as BrowserInspectorIssuesReport).issues).toEqual(report.issues)
  await panel.getByRole('button', { name: 'Close browser issues' }).click()
  // Human-controlled workspace access still gates the authenticated MCP caller.
  await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }), workspace.workspaceId)
  try {
    for (const action of ['list', 'clear']) expect((await call(action)).isError).toBe(true)
  } finally {
    await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: true }), workspace.workspaceId)
  }
  expect((JSON.parse(text(await call())) as BrowserInspectorIssuesReport).issues).toEqual(report.issues)
  const otherWorkspace = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'create', storage: 'scratch', name: 'Other CSP workspace' } }) as CallToolResult
  expect(otherWorkspace.isError, text(otherWorkspace)).not.toBe(true)
  const otherWorkspaceId = (JSON.parse(text(otherWorkspace)) as { id: string }).id
  for (const action of ['list', 'clear']) {
    const denied = await client.request({ method: 'tools/call', params: { name: 'browser_issues', arguments: { workspaceId: otherWorkspaceId, tabId, action } } }, CallToolResultSchema)
    expect(denied.isError).toBe(true)
    expect(text(denied)).not.toContain('cspDisposition')
  }
  const other = await client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl + '?other', active: false } }) as CallToolResult
  expect(other.isError, text(other)).not.toBe(true)
  const otherState = JSON.parse(text(other)) as { tabs: Array<{ id: string; url: string }> }
  const otherId = otherState.tabs.find((tab) => tab.url.endsWith('?other'))!.id
  expect((JSON.parse(text(await call('list', otherId))) as BrowserInspectorIssuesReport).issues.filter((issue) => issue.code === 'ContentSecurityPolicyIssue')).toEqual([])
  await client.callTool({ name: 'browser_close_tab', arguments: { tabId: otherId } })
  await call('clear')
  await emit(Array.from({ length: 205 }, (_, index) => ({ flag: index % 2 === 0, id: `retained-${index}` })))
  report = JSON.parse(text(await call())) as BrowserInspectorIssuesReport
  expect(report.issueCount).toBe(200)
  expect(report.truncated).toBe(true)
  expect(report.issues[0]!.id).toBe('retained-5')
  expect(report.errorCount).toBe(200)
  await call('clear')
  expect(JSON.parse(text(await call()))).toMatchObject({ issueCount: 0, truncated: false })
  await emit([{ flag: false }])
  expect((JSON.parse(text(await call())) as BrowserInspectorIssuesReport).issues).toEqual([expect.objectContaining({ cspDisposition: 'enforce' })])
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureUrl + '?new-document' } })
  expect((JSON.parse(text(await call())) as BrowserInspectorIssuesReport).issues.filter((issue) => issue.code === 'ContentSecurityPolicyIssue')).toEqual([])
})
