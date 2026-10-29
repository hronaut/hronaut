import { runInNewContext } from 'node:vm'
import type { WebContents } from 'electron'
import { describe, expect, it } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { setSnapshotBaseline, snapshotDelta, snapshotDetails } from '../src/main/browser/page-snapshots/page-snapshots.js'
import { compactTabDiscovery } from '../src/main/mcp/tab-discovery.js'
import { mcpWorkspaceState, mcpWorkspaceTab, savedWorkspaceWithoutUrlDetail } from '../src/main/mcp/tool-results.js'
import { BROWSER_SNAPSHOT_FORMAT_VERSION, type BrowserSnapshotDeltaContext } from '../src/shared/snapshot-delta.js'
import type { BrowserState } from '../src/shared/types.js'
import { titleShowsUrlDetail, urlWithoutDetail } from '../src/shared/url-detail.js'

const SECRET_URL = 'https://user-canary:pass-canary@shop.example.test:8443/checkout/step%202?session=query-canary&view=cart#fragment-canary'
const CANARIES = ['user-canary', 'pass-canary', 'query-canary', 'view=cart', 'fragment-canary']

describe('URL detail omission', () => {
  it('keeps an HTTP(S) address to its origin and path and never passes a malformed one through', () => {
    expect(urlWithoutDetail(SECRET_URL)).toBe('https://shop.example.test:8443/checkout/step%202')
    expect(urlWithoutDetail('http://example.test')).toBe('http://example.test/')
    expect(urlWithoutDetail('HTTPS://Example.TEST:443/a/b/?x=1#y')).toBe('https://example.test/a/b/')
    expect(urlWithoutDetail('about:blank')).toBe('about:blank')
    expect(urlWithoutDetail('about:blank#private')).toBe('about:')
    expect(urlWithoutDetail('file:///home/person/private.html')).toBe('file:')
    expect(urlWithoutDetail('data:text/html,private')).toBe('data:')
    expect(urlWithoutDetail('hronaut://home')).toBe('hronaut:')
    for (const malformed of ['', 'not a url', 'https://[broken', '/relative?x=1']) expect(urlWithoutDetail(malformed), malformed).toBe('')
  })

  it('leaves out a session id that a Java server keeps in the path', () => {
    // With URL detail omitted, agents still saw the session that the default redaction hides.
    expect(urlWithoutDetail('https://shop.example/cart;jsessionid=SECRET?step=2')).toBe('https://shop.example/cart;jsessionid=[REDACTED]')
    expect(urlWithoutDetail('https://shop.example/a;JSESSIONID=SECRET/b;v=2')).toBe('https://shop.example/a;JSESSIONID=[REDACTED]/b;v=2')
  })

  it('runs from its source text alone, as the snapshot scripts embed it', () => {
    expect(runInNewContext(`(${urlWithoutDetail.toString()})(value)`, { value: SECRET_URL, URL })).toBe('https://shop.example.test:8443/checkout/step%202')
    expect(runInNewContext(`(${urlWithoutDetail.toString()})(value)`, { value: 'https://shop.example/cart;jsessionid=SECRET', URL })).toBe('https://shop.example/cart;jsessionid=[REDACTED]')
    expect(runInNewContext(`(${urlWithoutDetail.toString()})(value)`, { value: 'nope', URL })).toBe('')
  })

  it('recognizes a title that shows the address instead of one the page set', () => {
    const url = 'https://shop.example.test/checkout?session=abc123'
    for (const title of [url, 'https://shop.example.test/checkout?sess', 'shop.example.test/checkout?session=abc123', 'shop.example.test', 'Order session=abc123']) {
      expect(titleShowsUrlDetail(title, url), title).toBe(true)
    }
    for (const title of ['Checkout', 'shop', 'https://shop', '', '   ']) expect(titleShowsUrlDetail(title, url), title).toBe(false)
    // A short fragment is too common in page text to count as an echo, and a word of a longer one counts only with its #.
    expect(titleShowsUrlDetail('Back to top', 'https://example.test/#top')).toBe(false)
    expect(titleShowsUrlDetail('All about cats', 'https://cats.example.test/#about')).toBe(false)
    expect(titleShowsUrlDetail('Table of contents', 'https://docs.example.test/guide#contents')).toBe(false)
    expect(titleShowsUrlDetail('Guide #contents', 'https://docs.example.test/guide#contents')).toBe(true)
    expect(titleShowsUrlDetail('Invite invite-code-canary-123', 'https://app.example.test/#invite-code-canary-123')).toBe(true)
    // Chromium shows an untitled http page without its scheme, decoding some escapes and keeping others.
    expect(titleShowsUrlDetail('shop.test/search?q=café&tok=ab%2Bc%3D%3D', 'http://shop.test/search?q=caf%C3%A9&tok=ab%2Bc%3D%3D')).toBe(true)
    expect(titleShowsUrlDetail('shop.test/search?q=café', 'http://shop.test/search?q=caf%C3%A9&tok=ab%2Bc%3D%3D')).toBe(true)
    // A page that names a search keeps its title; one that repeats the raw query, encoded or not, does not.
    expect(titleShowsUrlDetail('Café results', 'https://example.test/?q=Caf%C3%A9%20results')).toBe(false)
    expect(titleShowsUrlDetail('q=Café results', 'https://example.test/?q=Caf%C3%A9%20results')).toBe(true)
    expect(titleShowsUrlDetail('q=Caf%C3%A9%20results', 'https://example.test/?q=Caf%C3%A9%20results')).toBe(true)
    expect(titleShowsUrlDetail('not a url', 'not a url')).toBe(true)
  })

  it('projects tabs, closed tabs, page problems, dialogs and address titles, and marks the state', () => {
    const state = {
      tabs: [{
        id: 'tab-1', label: 'Customer checkout', title: SECRET_URL, url: SECRET_URL, mcpGroupId: 'w', mcpGroupName: 'Work',
        pageProblem: { kind: 'load-error', title: 'Page did not load', message: 'Connection refused', url: SECRET_URL, errorCode: -102 },
        dialog: { type: 'alert', message: 'Saved', url: SECRET_URL }
      }, { id: 'tab-2', title: 'Inbox', url: 'https://mail.example.test/inbox?folder=query-canary', mcpGroupId: 'w' }],
      closedTabs: [{ id: 'closed-1', title: 'https://other.example.test/reset?token=query-canary', url: 'https://other.example.test/reset?token=query-canary', pinned: false, closedAt: '2026-10-18T00:00:00.000Z', mcpGroupId: 'w' }],
      activeTabId: 'tab-1', allHumanInteractionLocked: false, mcpUrl: 'http://127.0.0.1:47321/mcp', profilePath: '/profile', mcpTabGroups: [], savedTabGroups: []
    } as unknown as BrowserState
    const omitted = mcpWorkspaceState(state, true)
    const text = JSON.stringify(omitted)
    for (const canary of CANARIES) expect(text, canary).not.toContain(canary)
    expect(omitted).toMatchObject({
      urlDetail: 'omitted',
      tabs: [
        { id: 'tab-1', label: 'Customer checkout', title: 'https://shop.example.test:8443/checkout/step%202', url: 'https://shop.example.test:8443/checkout/step%202', workspaceId: 'w', workspaceName: 'Work', urlDetail: 'omitted',
          pageProblem: { message: 'Connection refused', url: 'https://shop.example.test:8443/checkout/step%202', errorCode: -102 }, dialog: { message: 'Saved', url: 'https://shop.example.test:8443/checkout/step%202' } },
        { id: 'tab-2', title: 'Inbox', url: 'https://mail.example.test/inbox', urlDetail: 'omitted' }
      ],
      closedTabs: [{ id: 'closed-1', title: 'https://other.example.test/reset', url: 'https://other.example.test/reset', urlDetail: 'omitted' }]
    })
    // Off, the state is exactly what agents read before.
    const full = mcpWorkspaceState(state)
    expect(full).not.toHaveProperty('urlDetail')
    expect(JSON.stringify(full)).toContain('query-canary')
    expect((full.tabs as Array<Record<string, unknown>>)[0]).not.toHaveProperty('urlDetail')
    expect(state.tabs[0]!.url).toBe(SECRET_URL)
  })

  it('projects a page title that is a whole other address with detail, and keeps ordinary titles', () => {
    const tab = (title: string) => mcpWorkspaceTab({ id: 't', title, url: 'https://app.example.test/next' }, true)
    expect(tab('https://login.example.test/callback?code=query-canary').title).toBe('https://login.example.test/callback')
    expect(tab('https://docs.example.test/guide').title).toBe('https://docs.example.test/guide')
    expect(tab('Welcome back?').title).toBe('Welcome back?')
    expect(tab('').title).toBe('')
  })

  it('gives agents the hand-back note without detail, and never both notes', () => {
    const note = 'The person had this tab for 5 s and handed it back. The page moved from https://shop.example.test/cart?coupon=query-canary to https://shop.example.test/confirm?order=fragment-canary. They clicked or typed in the page. Read the page again before you continue.'
    const noteWithoutUrlDetail = 'The person had this tab for 5 s and handed it back. The page moved from https://shop.example.test/cart to https://shop.example.test/confirm. They clicked or typed in the page. Read the page again before you continue.'
    const tab = { id: 't', title: 'Order confirmed', url: 'https://shop.example.test/confirm?order=fragment-canary', handedBack: { at: 5, note, noteWithoutUrlDetail } }
    const omitted = mcpWorkspaceTab(tab, true)
    expect(omitted.handedBack).toEqual({ at: 5, note: noteWithoutUrlDetail })
    for (const canary of CANARIES) expect(JSON.stringify(omitted), canary).not.toContain(canary)
    expect(mcpWorkspaceTab(tab).handedBack).toEqual({ at: 5, note })
    // A note whose page stayed put names no address, so it serves both.
    expect(mcpWorkspaceTab({ ...tab, handedBack: { at: 5, note: 'The page stayed at the same address.' } }, true).handedBack).toEqual({ at: 5, note: 'The page stayed at the same address.' })
  })

  it('shows saved workspaces and their tabs without detail, in workspace state too', () => {
    const saved = { id: 's', name: 'Checkout', tabs: [{ title: SECRET_URL, url: SECRET_URL, pinned: false }, { title: 'Inbox', url: 'https://mail.example.test/?folder=query-canary', pinned: true }] }
    expect(savedWorkspaceWithoutUrlDetail(saved)).toMatchObject({
      urlDetail: 'omitted',
      tabs: [{ title: 'https://shop.example.test:8443/checkout/step%202', url: 'https://shop.example.test:8443/checkout/step%202' }, { title: 'Inbox', url: 'https://mail.example.test/' }]
    })
    const state = { tabs: [], closedTabs: [], mcpTabGroups: [], savedTabGroups: [saved] } as unknown as BrowserState
    for (const canary of CANARIES) expect(JSON.stringify(mcpWorkspaceState(state, true)), canary).not.toContain(canary)
    expect(JSON.stringify(mcpWorkspaceState(state))).toContain('query-canary')
  })

  it('searches tab addresses without their detail when it is omitted', () => {
    const tabs = [{ id: 'one', title: 'Billing', url: SECRET_URL }]
    const result = compactTabDiscovery(tabs, {}, true)
    expect(result).toMatchObject({ urlDetail: 'omitted', tabs: [{ url: 'https://shop.example.test:8443/checkout/step%202' }] })
    for (const canary of CANARIES) expect(JSON.stringify(result), canary).not.toContain(canary)
    expect(compactTabDiscovery(tabs, { query: 'view=cart' }, true).matching).toBe(0)
    expect(compactTabDiscovery(tabs, { query: 'view=cart' }).matching).toBe(1)
    expect(compactTabDiscovery(tabs, {})).not.toHaveProperty('urlDetail')
    // A page that names itself by an address with detail is found by that address's origin and path only.
    const named = [{ id: 'two', title: 'https://login.example.test/callback?code=query-canary', url: 'https://app.example.test/' }]
    expect(compactTabDiscovery(named, { query: 'callback' }, true)).toMatchObject({ tabs: [{ title: 'https://login.example.test/callback' }] })
    expect(compactTabDiscovery(named, { query: 'query-canary' }, true).matching).toBe(0)
  })
})

describe('snapshot URL lines without detail', () => {
  const CONTEXT: BrowserSnapshotDeltaContext = { tabId: 'tab-1', workspaceId: 'w', navigationGeneration: 1, observationGeneration: 1, humanInteractionGeneration: 0, snapshotFormatVersion: BROWSER_SNAPSHOT_FORMAT_VERSION }

  /** A page whose snapshot script answers with a URL line in the form the script was asked for. */
  function fakePage() {
    let omit = false
    const scripts: string[] = []
    const webContents = {
      isDestroyed: () => false,
      executeJavaScriptInIsolatedWorld: async (_world: number, sources: Array<{ code: string }>) => {
        scripts.push(sources[0]!.code)
        const omitted = sources[0]!.code.includes("add(true ? 'URL: '")
        const text = `URL: ${omitted ? 'https://shop.example.test/checkout (query and fragment omitted)' : 'https://shop.example.test/checkout?view=cart'}\nTITLE: Checkout`
        return { formatVersion: BROWSER_SNAPSHOT_FORMAT_VERSION, text, maxChars: 30_000, returnedChars: text.length, truncated: false, omitted: { headings: false, controls: false, bodyText: false, characters: false } }
      }
    } as unknown as WebContents
    const tab = { id: 'tab-1', url: 'https://shop.example.test/checkout?view=cart', mcpGroupId: 'w', webContents, walletNavigationGeneration: 0, snapshotBaselineGeneration: 0 } as unknown as BrowserTab
    const baselines = new Map()
    const baselineIds = new Map<string, string>()
    const browser = {
      tabs: new Map([[tab.id, tab]]),
      mcpTabGroups: new Map([['w', { activeTabId: tab.id }]]),
      options: { getOmitAgentUrlDetail: () => omit },
      snapshotDeltaContext: () => CONTEXT,
      snapshotBaselines: baselines,
      snapshotBaselineIdsByTab: baselineIds
    } as unknown as Browser
    return { browser, scripts, setOmit: (value: boolean) => { omit = value } }
  }

  it('asks the page for the URL line the setting calls for and marks the snapshot', async () => {
    const page = fakePage()
    expect(await snapshotDetails(page.browser, 'tab-1')).not.toHaveProperty('urlDetail')
    expect(page.scripts[0]).toContain("add(false ? 'URL: '")
    page.setOmit(true)
    const snapshot = await snapshotDetails(page.browser, 'tab-1')
    expect(snapshot).toMatchObject({ urlDetail: 'omitted', text: expect.stringContaining('(query and fragment omitted)') })
    expect(page.scripts[1]).toContain("add(true ? 'URL: '")
  })

  it('starts a delta over instead of comparing URL lines across a change of the setting', async () => {
    const page = fakePage()
    const baseline = await setSnapshotBaseline(page.browser, 'tab-1')
    page.setOmit(true)
    const delta = await snapshotDelta(page.browser, { tabId: 'tab-1', baselineId: baseline.baselineId })
    expect(delta).toMatchObject({ status: 'invalidated', invalidationReason: 'snapshot-format', changes: [] })
    expect(JSON.stringify(delta)).not.toContain('view=cart')
    const fresh = await setSnapshotBaseline(page.browser, 'tab-1')
    expect(await snapshotDelta(page.browser, { tabId: 'tab-1', baselineId: fresh.baselineId })).toMatchObject({ status: 'unchanged' })
  })
})
