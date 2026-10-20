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

/** A page whose loads finish at once, unless a test holds them; it can also ask before leaving, as a draft editor does. */
class FakePage extends EventEmitter {
  shown: string
  loadingMainFrame = false
  asksBeforeLeaving = false
  readonly stop = vi.fn(() => { this.loadingMainFrame = false })
  readonly loadURL = vi.fn(async (url: string) => {
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
}

interface FakeTab extends WorkspaceNavigationTab { page: FakePage }

function tab(id: string, url: string, options: { sleeping?: boolean } = {}): FakeTab {
  const page = new FakePage(options.sleeping ? 'data:text/html,sleeping' : url)
  return {
    id, url, mcpGroupId: 'workspace', page, webContents: page as unknown as WebContents,
    sleeping: options.sleeping === true,
    sleepNavigationHistory: options.sleeping ? { entries: [{ url, title: 'Blocked' }], index: 0 } : undefined
  }
}

function access(tabs: FakeTab[], policy: BrowserWorkspaceNavigationPolicy = { mode: 'unrestricted', rules: [] }) {
  const workspace: WorkspaceNavigationWorkspace = { contextClass: 'standard', lastUsedAt: '', navigationPolicy: policy, navigationAudit: [] }
  const wakeTab = vi.fn(async (id: string) => {
    const woken = tabs.find((candidate) => candidate.id === id)!
    woken.sleeping = false
    await woken.page.loadURL(woken.url)
  })
  const port: WorkspaceNavigationAccess<FakeTab> = {
    findWorkspace: (id) => id === 'workspace' ? workspace : undefined,
    findArchivedWorkspace: () => undefined,
    assertWorkspaceIdle: () => undefined,
    inspectionPermission: () => undefined,
    setInspectionPermission: () => undefined,
    tabs: () => tabs[Symbol.iterator](),
    options: () => ({}),
    prepareDiagnosticNavigation: () => undefined,
    wakeTab,
    changed: () => undefined,
    getState: () => ({}) as BrowserState
  }
  return { port, workspace, wakeTab }
}

describe('restricting a workspace', () => {
  it('wakes a sleeping tab on a blank page instead of leaving it to wake to the denied page', async () => {
    const sleeping = tab('sleeping', `${BLOCKED}/draft`, { sleeping: true })
    const { port, workspace, wakeTab } = access([sleeping])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(wakeTab).toHaveBeenCalledExactlyOnceWith('sleeping')
    expect(sleeping).toMatchObject({ url: 'about:blank', sleeping: false, sleepNavigationHistory: undefined })
    expect(sleeping.page.loadURL.mock.calls.map(([url]) => url)).toEqual(['about:blank'])
    expect(workspace.navigationAudit).toEqual([expect.objectContaining({ targetOrigin: BLOCKED, source: 'policy-change' })])
  })

  it('leaves a sleeping tab on an allowed page asleep with its history', async () => {
    const sleeping = tab('sleeping', `${ALLOWED}/docs`, { sleeping: true })
    const { port, wakeTab } = access([sleeping])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(wakeTab).not.toHaveBeenCalled()
    expect(sleeping).toMatchObject({ url: `${ALLOWED}/docs`, sleeping: true })
    expect(sleeping.sleepNavigationHistory).toBeDefined()
  })

  it('stops a page still loading before checking it, so it cannot open after the check', async () => {
    const loading = tab('loading', `${ALLOWED}/start`)
    loading.page.loadingMainFrame = true
    const { port } = access([loading])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(loading.page.stop).toHaveBeenCalledOnce()
    expect(loading.page.loadURL).not.toHaveBeenCalled()
  })

  it('does not stop a loading page when the policy stays the same', async () => {
    const loading = tab('loading', `${ALLOWED}/start`)
    loading.page.loadingMainFrame = true
    const { port } = access([loading], RESTRICTED)

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(loading.page.stop).not.toHaveBeenCalled()
  })

  it('blanks a denied page that opened before the tab caught up with it', async () => {
    const opened = tab('opened', `${ALLOWED}/start`)
    opened.page.shown = `${BLOCKED}/slow-page`
    const { port } = access([opened])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(opened.page.getURL()).toBe('about:blank')
  })

  it('blanks a denied page that asks before leaving, and stops skipping its question afterwards', async () => {
    const draft = tab('draft', `${BLOCKED}/unsaved-draft`)
    draft.page.asksBeforeLeaving = true
    const { port } = access([draft])

    await updateWorkspaceNavigationPolicy(port, 'workspace', RESTRICTED)

    expect(draft.page.getURL()).toBe('about:blank')
    expect(draft.page.listenerCount('will-prevent-unload')).toBe(0)
  })
})
