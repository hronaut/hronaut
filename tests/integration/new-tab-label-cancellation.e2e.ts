import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { HronautApi } from '../../src/shared/types.js'
import { test, expect, text, installLabelFault, labelFault, releaseLabelFault, restoreLabelFault } from './new-tab-label-fixtures.js'

for (const stage of ['hold-write', 'hold-rename', 'hold-flush'] as const) {
  for (const change of ['cancel', 'workspace access', 'global pause'] as const) {
    test(`${change} during ${stage} retains creation persistence ownership and withholds success`, async ({ capabilities, electronApp, appWindow, profileDirectory }, info) => {
      const { client, workspace, fixtureUrl } = capabilities
      const marker = 'Private creation cancellation role'
      await installLabelFault(electronApp, profileDirectory, marker, stage)
      const abort = new AbortController()
      let creation: Promise<CallToolResult> | undefined
      const transport = client.transport as StreamableHTTPClientTransport
      const received: string[] = []
      const onmessage = transport.onmessage!
      transport.onmessage = message => { received.push(JSON.stringify(message)); onmessage(message) }
      try {
        const prior = new Set((await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())).tabs.map(tab => tab.id))
        creation = (client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl, label: marker } }, undefined, { signal: abort.signal }) as Promise<CallToolResult>).catch(() => ({ isError: true, content: [{ type: 'text', text: 'Client cancelled' }] }))
        await expect.poll(async () => (await labelFault(electronApp)).entered).toBe(true)
        const state = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
        const id = state.tabs.find(tab => !prior.has(tab.id))!.id
        if (change === 'cancel') {
          abort.abort()
          await creation
          const busy = await client.callTool({ name: 'browser_new_tab', arguments: { url: fixtureUrl } }) as CallToolResult
          expect(busy.isError).toBe(true)
          expect(JSON.parse(text(busy)).reason).toBe('WORKSPACE_BUSY')
        } else if (change === 'workspace access') {
          await appWindow.evaluate(id => (window as unknown as { hronaut: HronautApi }).hronaut.updateTabGroup(id, { agentAccess: false }), workspace.workspaceId)
        } else await appWindow.evaluate('window.hronautMcp.setPaused(true)')
        await releaseLabelFault(electronApp)
        const result = await creation
        expect(result.isError).toBe(true)
        expect(text(result)).not.toContain(marker)
        expect(text(result)).not.toContain('createdTabId')
        await expect.poll(() => electronApp.evaluate(async ({ webContents }) => {
          const home = webContents.getAllWebContents().find(page => page.getURL().startsWith('hronaut://home'))!
          return home.executeJavaScript("fetch('/api/status').then(r=>r.json()).then(s=>s.recentActivity.filter(a=>a.toolName==='browser_new_tab').map(a=>({outcome:a.outcome,result:a.result})))")
        })).toContainEqual(expect.objectContaining({ outcome: 'failed', result: expect.objectContaining({ outcome: change === 'cancel' ? 'cancelled' : 'outcome-unknown', effects: 'possible' }) }))
        const current = await appWindow.evaluate(() => (window as unknown as { hronaut: HronautApi }).hronaut.getState())
        const tab = current.tabs.find(tab => tab.id === id)!
        expect(tab.label).toBe(stage === 'hold-write' ? undefined : marker)
        // The pre-rename check cannot make the asynchronous rename atomic with
        // later revocation; a committed label remains committed, never rolled back.
        if (stage !== 'hold-write') {
          const saved = JSON.parse(await readFile(join(profileDirectory, 'tabs.json'), 'utf8'))
          expect(saved.tabs.find((tab: { id: string }) => tab.id === id).label).toBe(marker)
        }
        expect(received.join('\n')).not.toContain('"labelPersistence":"saved"')
        await info.attach('label-cancellation-boundary', { body: JSON.stringify({ stage, change, committed: stage !== 'hold-write', result: JSON.parse(JSON.stringify(result)) }), contentType: 'application/json' })
      } finally {
        await restoreLabelFault(electronApp)
        await Promise.allSettled([creation].filter(Boolean))
        transport.onmessage = onmessage
      }
    })
  }
}
