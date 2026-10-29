import { describe, expect, it } from 'vitest'
import { getState } from '../src/main/browser/browser-state/browser-state.js'
import { trustRefusedCertificate } from '../src/main/browser/certificate-errors/certificate-errors.js'

/** A stand-in for whatever the state reads on the tab manager: any call or property gives another stand-in. */
function anything(): unknown {
  const stand: unknown = new Proxy(() => undefined, {
    get: (_target, key) => key === 'then' || key === Symbol.iterator ? undefined : stand,
    apply: () => stand
  })
  return stand
}

/** The published state of one tab showing a page, in a workspace's session. */
function stateOf(url: string, session: object, destroyed = false, shown: object = {}) {
  const tab = {
    id: 'tab', title: 'Login', url, loading: false, observationGeneration: 0, navigationGeneration: 0, documentGeneration: 0, pinned: false, sleeping: false, networkRoutes: [], inspectorIssues: [],
    webContents: { session, isDestroyed: () => destroyed, getZoomFactor: () => 1, isDevToolsOpened: () => false },
    ...shown
  }
  const own: Record<string, unknown> = {
    orderedTabs: () => [tab],
    closedTabs: () => [],
    activeTabId: () => 'tab',
    splitView: () => null,
    listMcpTabGroups: () => [],
    listSavedTabGroups: () => [],
    publishedAgentFollow: () => undefined,
    options: () => ({ profilePath: '/profile' }),
    isTabTakenOver: () => false
  }
  const fallback = anything() as Record<string | symbol, unknown>
  const access = new Proxy({}, { get: (_target, key) => (typeof key === 'string' && key in own ? own[key] : fallback[key]) })
  return getState(access as never).tabs[0]!
}

describe('a page whose certificate the person chose to trust', () => {
  it('is marked in the state, so the address bar says it is not secure, for the host in that workspace only', () => {
    const workspace = {}
    const page = 'https://staging.example/login'
    expect(stateOf(page, workspace)).not.toHaveProperty('untrustedCertificate')
    trustRefusedCertificate({ webContents: { session: workspace } }, {
      url: page, host: 'staging.example', error: 'ERR_CERT_AUTHORITY_INVALID', fingerprint: 'sha256/abc=', canProceed: true
    })
    expect(stateOf(page, workspace).untrustedCertificate).toBe(true)
    expect(stateOf('https://staging.example/other', workspace).untrustedCertificate).toBe(true)
    expect(stateOf('https://other.example/', workspace)).not.toHaveProperty('untrustedCertificate')
    // A host whose name ends the trusted one's is another website.
    expect(stateOf('https://ging.example/', workspace)).not.toHaveProperty('untrustedCertificate')
    expect(stateOf(page, {})).not.toHaveProperty('untrustedCertificate')
    expect(stateOf(page, workspace, true)).not.toHaveProperty('untrustedCertificate')
  })

  it('is marked while the tab shows the privacy error for its website, as Chrome says the page is not secure', () => {
    const problem = { kind: 'load-error', url: 'https://bank.example/', title: 'Privacy error', message: 'Your connection is not private', certificate: { host: 'bank.example', canProceed: false } }
    expect(stateOf('https://bank.example/', {}, false, { pageProblem: problem }).untrustedCertificate).toBe(true)
  })
})
