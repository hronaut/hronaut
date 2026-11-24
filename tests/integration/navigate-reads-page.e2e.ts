import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { expect, test } from './capability-fixtures.js'

// browser_navigate returns the tab it loaded and a snapshot of the page, so an agent reads the page in the same call.
// A tab still loading its first page settled the load early, and the snapshot read the page it was leaving.

const loaded = (result: CallToolResult) => JSON.parse((result.content[0] as { text: string }).text) as {
  tabId: string; url: string; title: string; loading: boolean; snapshot?: { returnedChars?: number; status?: string; reason?: string }
}
const page = (result: CallToolResult) => result.content.slice(1).map(item => item.type === 'text' ? item.text : '').join('\n')

test('returns the loaded page and its snapshot, also from a new tab still loading its first page', async ({ capabilities }) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) as Promise<CallToolResult>
  const target = `${fixtureOrigin}/issues`

  const navigated = await call('browser_navigate', { tabId, url: target })
  expect(navigated.isError, page(navigated)).not.toBe(true)
  expect(loaded(navigated)).toMatchObject({ tabId, url: target, title: 'Browser issues fixture', loading: false })
  expect(loaded(navigated).snapshot?.returnedChars).toBeGreaterThan(0)
  expect(page(navigated)).toContain('Intentionally missing a doctype.')

  const bare = await call('browser_navigate', { tabId, url: `${target}?again`, read: 'none' })
  expect(bare.content).toHaveLength(1)
  expect(loaded(bare)).not.toHaveProperty('snapshot')

  for (let attempt = 0; attempt < 3; attempt++) {
    const opened = await call('browser_new_tab', { url: 'about:blank', active: true })
    expect(opened.isError, page(opened)).not.toBe(true)
    const fresh = await call('browser_navigate', { url: target })
    expect(fresh.isError, page(fresh)).not.toBe(true)
    expect(loaded(fresh), `attempt ${attempt}`).toMatchObject({ url: target, title: 'Browser issues fixture', loading: false })
    expect(page(fresh), JSON.stringify(loaded(fresh))).toContain('Intentionally missing a doctype.')
  }
})
