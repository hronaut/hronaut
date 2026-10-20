import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserState, BrowserWorkspaceNavigationPolicy } from '../src/shared/types.js'
import { updateWorkspaceNavigationPolicy } from '../src/main/browser/workspace-navigation/workspace-navigation.js'
import type {
  WorkspaceNavigationAccess,
  WorkspaceNavigationTab,
  WorkspaceNavigationWorkspace
} from '../src/main/browser/workspace-navigation/workspace-navigation-access.js'

const ALLOWED = 'https://allowed.example'
const BLOCKED = 'https://blocked.example'
const RESTRICTED: BrowserWorkspaceNavigationPolicy = { mode: 'restricted', rules: [ALLOWED] }
const UNRESTRICTED: BrowserWorkspaceNavigationPolicy = { mode: 'unrestricted', rules: [] }

/** A page whose loads finish at once, unless a test fails them; it can also ask before leaving, as a draft editor does. */
class FakePage extends EventEmitter {
  shown: string
  loadingMainFrame = false
  asksBeforeLeaving = false
  destroyed = false
  failure: Error | undefined
  readonly stop = vi.fn(() => { this.loadingMainFrame = false })
  readonly loadURL = vi.fn(async (url: string) => {
    if (this.failure) throw this.failure
    if (this.asksBeforeLeaving) {
      let skipped = false
      this.emit('will-prevent-unload', { preventDefault: () => { skipped = true } })
      if (!skipped) throw Object.assign(new Error('ERR_ABORTED (-3) loading'), { code: 'ERR_ABORTED' })
    }
    this.shown = url
  })

  constructor(url: string) {
    super()
    this.shown = url
  }

  getURL(): string { return this.shown }
  isLoadingMainFrame(): boolean { return this.loadingMainFrame }
  isDestroyed(): boolean { return this.destroyed }
}

interface FakeTab extends WorkspaceNavigationTab { page: FakePage }

function tab(id: string, url: string, options: { sleeping?: boolean } = {}): FakeTab {
  const page = new FakePage(options.sleeping ? 'data:text/html,sleeping' : url)
  return {
    id, url, title: `Page ${id}`, faviconDataUrl: 'data:image/png;base64,icon', mcpGroupId: 'workspace', page,
    webContents: page as unknown as WebContents,
    sleeping: options.sleeping === true,
    sleepNavigationHistory: options.sleeping ? { entries: [{ url, title: 'Blocked' }], index: 0 } : undefined
  }
}

/** The workspace with these tabs open, in this order, and the policy it has before the change. */
function access(tabs: FakeTab[], policy: BrowserWorkspaceNavigationPolicy = UNRESTRICTED) {
  const open = new Map(tabs.map((candidate) => [candidate.id, candidate]))
  const workspace: WorkspaceNavigationWorkspace = { contextClass: 'standard', lastUsedAt: '', navigationPolicy: policy, navigationAudit: [] }
  const wakeTab = vi.fn(async (id: string) => {
    const woken = open.get(id)!
    woken.sleeping = false
    await woken.page.loadURL(woken.url)
  })
  const port: WorkspaceNavigationAccess<FakeTab> = {
    findWorkspace: (id) => id === 'workspace' ? workspace : undefined,
    findArchivedWorkspace: () => undefined,
    assertWorkspaceIdle: () => undefined,
    inspectionPermission: () => undefined,
    setInspectionPermission: () => undefined,
    tabs: () => open.values(),
    findTab: (id) => open.get(id),
    options: () => ({}),
    prepareDiagnosticNavigation: () => undefined,
    wakeTab,
    changed: () => undefined,
    getState: () => ({}) as BrowserState
  }
  const close = (closed: FakeTab) => {
    open.delete(closed.id)
    closed.page.destroyed = true
  }
  return { port, workspace, wakeTab, close }
}

describe('restricting a workspace', () => {
  it('wakes a sleeping tab on a blank page instead of leaving it to wake to the denied page', async () => {
    const sleeping = tab('sleeping', `${BLOCKED}/draft`, { sleeping: true })
    const { port, workspace, wakeTab } = access([sleeping])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(wakeTab).toHaveBeenCalledExactlyOnceWith('sleeping')
    expect(sleeping).toMatchObject({ url: 'about:blank', sleeping: false, sleepNavigationHistory: undefined, title: 'New tab', faviconDataUrl: undefined })
    expect(sleeping.page.loadURL.mock.calls.map(([url]) => url)).toEqual(['about:blank'])
    expect(workspace.navigationAudit).toEqual([expect.objectContaining({ targetOrigin: BLOCKED, source: 'policy-change' })])
  })

  it('leaves a sleeping tab on an allowed page asleep with its history', async () => {
    const sleeping = tab('sleeping', `${ALLOWED}/docs`, { sleeping: true })
    const { port, wakeTab } = access([sleeping])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(wakeTab).not.toHaveBeenCalled()
    expect(sleeping).toMatchObject({ url: `${ALLOWED}/docs`, sleeping: true, title: 'Page sleeping' })
    expect(sleeping.sleepNavigationHistory).toBeDefined()
  })

  it('checks a waking tab by the page it wakes to, not its sleeping placeholder, without waiting for it', async () => {
    // The wake is still waiting for its page, and never finishes here.
    const toAllowed = tab('to-allowed', `${ALLOWED}/docs`)
    const toBlocked = tab('to-blocked', `${BLOCKED}/draft`)
    for (const waking of [toAllowed, toBlocked]) {
      waking.page.shown = 'data:text/html,sleeping'
      waking.page.loadingMainFrame = true
      waking.pendingMainFrameUrl = waking.url
    }
    const { port, workspace } = access([toAllowed, toBlocked])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    // The placeholder used to be checked and denied, so a tab waking to an allowed page was blanked and slept again.
    expect(toAllowed.page.loadURL).not.toHaveBeenCalled()
    expect(toAllowed.page.stop).not.toHaveBeenCalled()
    expect(toBlocked.page.loadURL.mock.calls.map(([url]) => url)).toEqual(['about:blank'])
    expect(toBlocked).toMatchObject({ title: 'New tab', faviconDataUrl: undefined })
    expect(workspace.navigationAudit).toEqual([expect.objectContaining({ targetOrigin: BLOCKED, source: 'policy-change' })])
  })

  it('blanks a denied page and clears its title and icon', async () => {
    const blocked = tab('blocked', `${BLOCKED}/page`)
    const { port } = access([blocked])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(blocked.page.getURL()).toBe('about:blank')
    expect(blocked).toMatchObject({ title: 'New tab', faviconDataUrl: undefined })
  })

  it('stops a navigation under way to a site the rules no longer allow, and keeps the allowed page it would replace', async () => {
    const leaving = tab('leaving', `${ALLOWED}/start`)
    leaving.page.loadingMainFrame = true
    leaving.pendingMainFrameUrl = `${BLOCKED}/slow-page`
    const { port, workspace } = access([leaving])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(leaving.page.stop).toHaveBeenCalledOnce()
    expect(leaving.page.loadURL).not.toHaveBeenCalled()
    expect(leaving).toMatchObject({ url: `${ALLOWED}/start`, title: 'Page leaving' })
    expect(workspace.navigationAudit).toEqual([expect.objectContaining({ targetOrigin: BLOCKED, source: 'policy-change' })])
  })

  it('lets allowed pages keep loading, and stops nothing when the rules are loosened or unchanged', async () => {
    const opening = tab('opening', `${ALLOWED}/start`)
    opening.page.loadingMainFrame = true
    opening.pendingMainFrameUrl = `${ALLOWED}/next`
    const committed = tab('committed', `${ALLOWED}/images`)
    committed.page.loadingMainFrame = true
    const restricted = access([opening, committed])
    // A page that opened but is still loading its images was stopped too, and a new tab still opening failed.
    await updateWorkspaceNavigationPolicy(restricted.port, 'workspace', RESTRICTED)
    await updateWorkspaceNavigationPolicy(restricted.port, 'workspace', RESTRICTED)

    const loosening = tab('loosening', `${ALLOWED}/start`)
    loosening.page.loadingMainFrame = true
    loosening.pendingMainFrameUrl = `${BLOCKED}/page`
    await updateWorkspaceNavigationPolicy(access([loosening], RESTRICTED).port, 'workspace', UNRESTRICTED)

    for (const page of [opening, committed, loosening].map((candidate) => candidate.page)) {
      expect(page.stop).not.toHaveBeenCalled()
      expect(page.loadURL).not.toHaveBeenCalled()
    }
  })

  it('blanks a denied page that asks before leaving, and asks as usual afterwards', async () => {
    const draft = tab('draft', `${BLOCKED}/unsaved-draft`)
    draft.page.asksBeforeLeaving = true
    const { port } = access([draft])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(draft.page.getURL()).toBe('about:blank')
    expect(draft.page.listenerCount('will-prevent-unload')).toBe(0)
  })

  it('skips a tab closed while an earlier one is replaced, and still checks the tabs after it', async () => {
    const first = tab('first', `${BLOCKED}/one`)
    const closing = tab('closing', `${BLOCKED}/two`, { sleeping: true })
    const last = tab('last', `${BLOCKED}/three`)
    const { port, wakeTab, close } = access([first, closing, last])
    first.page.loadURL.mockImplementationOnce(async (url: string) => {
      close(closing)
      first.page.shown = url
    })

    // Checking a closed tab used to fail the update, and the tabs after it kept their denied pages.
    await expect(updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)).resolves.toBeDefined()

    expect(wakeTab).not.toHaveBeenCalled()
    expect(last.page.getURL()).toBe('about:blank')
  })

  it('checks every tab before reporting one that could not be replaced', async () => {
    const failing = tab('failing', `${BLOCKED}/one`)
    failing.page.failure = new Error('ERR_FAILED (-2) loading')
    const after = tab('after', `${BLOCKED}/two`)
    const { port } = access([failing, after])

    await expect(updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)).rejects.toThrow('ERR_FAILED')

    expect(after.page.getURL()).toBe('about:blank')
  })
})
