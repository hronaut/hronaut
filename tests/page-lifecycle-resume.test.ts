import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import type { BrowserState } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { controlPageLifecycle } = await import('../src/main/browser/page-lifecycle/page-lifecycle.js')
type PageLifecycleAccess = import('../src/main/browser/page-lifecycle/page-lifecycle-access.js').PageLifecycleAccess<PageTab>
type PageTab = import('../src/main/browser/page-lifecycle/page-lifecycle-access.js').PageLifecycleTab

/** A frozen tab on screen, and a manager that notes when it shows the tab's page. */
function frozenTab() {
  const commands: string[] = []
  const webContents = {
    id: 3,
    isDestroyed: () => false,
    isDevToolsOpened: () => false,
    getBackgroundThrottling: () => false,
    setBackgroundThrottling: vi.fn(),
    executeJavaScript: vi.fn(async () => []),
    debugger: {
      isAttached: () => true,
      sendCommand: vi.fn(async (method: string, params?: { state?: string }) => { commands.push(`${method} ${params?.state ?? ''}`) })
    }
  } as unknown as WebContents
  const tab: PageTab = {
    id: 'tab',
    url: 'https://example.com/',
    navigationGeneration: 1,
    nativeInputEnvironmentGeneration: 0,
    sleeping: false,
    webContents,
    pageLifecycleState: 'frozen',
    pageLifecycleAnimations: []
  }
  const showResumedPage = vi.fn(() => { commands.push(`show ${tab.pageLifecycleState}`) })
  const access: PageLifecycleAccess = {
    getTab: () => tab,
    findTab: () => tab,
    isDestroyed: () => false,
    inDebuggerQueue: (_id, operation) => operation(),
    dialogMonitorAttach: () => undefined,
    isDevToolsOpening: () => false,
    showResumedPage,
    changed: vi.fn(),
    getState: () => ({}) as BrowserState
  }
  return { tab, access, commands, showResumedPage }
}

describe('resuming a frozen page', () => {
  it('shows the page on screen as it resumes it, before reporting done', async () => {
    // Chromium hides a page it freezes and leaves it hidden when it resumes, so the resumed page's timers and frames
    // stayed throttled until a later check found it hidden.
    const page = frozenTab()
    await expect(controlPageLifecycle(page.access, 'tab', 'active')).resolves.toMatchObject({ state: 'active', status: 'changed' })
    expect(page.showResumedPage).toHaveBeenCalledExactlyOnceWith(page.tab)
    expect(page.commands).toEqual(['Page.setWebLifecycleState active', 'show active'])
  })

  it('does not show a page it freezes', async () => {
    const page = frozenTab()
    page.tab.pageLifecycleState = 'active'
    await expect(controlPageLifecycle(page.access, 'tab', 'frozen')).resolves.toMatchObject({ state: 'frozen', status: 'changed' })
    expect(page.showResumedPage).not.toHaveBeenCalled()
  })
})
