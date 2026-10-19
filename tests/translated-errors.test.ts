import { describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))

const { LocalizedError, withTranslatedIpcErrors } = await import('../src/main/localized-error.js')
const { translate } = await import('../src/shared/i18n.js')
const { MAX_BROWSER_TABS } = await import('../src/shared/types.js')
const { BrowserTabsManager } = await import('../src/main/browser/tabs-manager.js')
const { RendererExitedError } = await import('../src/main/browser/renderer-exit-guard.js')
const { WorkspaceMetadataError } = await import('../src/main/browser/tab-store.js')
const { waitForPage } = await import('../src/main/browser/page-waits/page-waits.js')
const { navigate } = await import('../src/main/browser/page-navigation/page-navigation.js')
const { assertWorkspaceNavigationAllowed } = await import('../src/main/browser/workspace-navigation/workspace-navigation.js')
const { reorderTab } = await import('../src/main/browser/tab-arrangement/tab-arrangement.js')
const { setZoom } = await import('../src/main/browser/page-zoom/page-zoom.js')
const { controlPageLifecycle } = await import('../src/main/browser/page-lifecycle/page-lifecycle.js')
const { setTabHumanInteractionLocked } = await import('../src/main/browser/interaction-lock/interaction-lock.js')
const { BookmarkStore } = await import('../src/main/bookmark-store.js')
const { selectTabAndWait } = await import('../src/main/browser/tab-selection/tab-selection.js')
const { createNewTab } = await import('../src/main/browser/new-tabs/new-tabs.js')
const { requireMcpTabGroup } = await import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')
const { assertWorkspaceIdle } = await import('../src/main/browser/workspace-operations/workspace-operations.js')

const SHELL_URL = 'http://127.0.0.1:5173/'
const ukrainian = (key: Parameters<typeof translate>[1], parameters?: Parameters<typeof translate>[2]) => translate('uk-UA', key, parameters)

/** What a page that called a failing IPC handler reads: the shell gets Ukrainian here, a website the English. */
async function shownTo(url: string, error: unknown): Promise<string> {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  const ipcMain = { handle: (channel: string, listener: Parameters<IpcMain['handle']>[1]) => { handlers.set(channel, listener) }, on: () => ipcMain }
  withTranslatedIpcErrors(ipcMain as unknown as Pick<IpcMain, 'handle' | 'on'>, {
    isHronautPage: (event) => event.senderFrame?.url === SHELL_URL,
    text: ukrainian
  }).handle('action', () => { throw error })
  const thrown = await Promise.resolve(handlers.get('action')!({ senderFrame: { url } } as unknown as IpcMainInvokeEvent)).catch((caught: unknown) => caught)
  return (thrown as Error).message
}

/** The error an action throws, whether it throws at once or rejects. */
async function failure(action: () => unknown): Promise<unknown> {
  try {
    await action()
  } catch (error) {
    return error
  }
  throw new Error('The action did not fail')
}

const destroyed = { isDestroyed: () => true }
const homeTab = { id: 'home', url: 'hronaut://home/', pinned: false, nativeInputEnvironmentGeneration: 0 }
const websiteTab = { id: 'site', url: 'https://example.test/', pinned: false, nativeInputEnvironmentGeneration: 0 }
const manager = (activeTabId: string | null) => Object.assign(Object.create(BrowserTabsManager.prototype), { tabs: new Map(), activeTabId }) as InstanceType<typeof BrowserTabsManager>
const restrictedWorkspace = {
  findWorkspace: () => ({ navigationPolicy: { mode: 'restricted', rules: ['https://allowed.example'] }, navigationAudit: [] }),
  options: () => ({}),
  changed: () => undefined
}

describe('main-process failures people see in tabs, navigation and new tabs', () => {
  it.each([
    // Guards on every shell call
    ['a crashed page', () => { throw new RendererExitedError(false) },
      'The page is not running because its renderer exited; nothing was sent to it. Reload or close the tab, then inspect fresh state.',
      'Сторінка не працює, бо її процес завершився; їй нічого не надіслано. Перезавантажте або закрийте вкладку й перевірте її поточний стан.'],
    ['unreadable workspace metadata', () => { throw new WorkspaceMetadataError('invalid-json') },
      'Saved workspace metadata is unavailable (invalid-json). Startup stopped to preserve recovery options.',
      'Метадані збережених робочих просторів недоступні (invalid-json). Запуск зупинено, щоб зберегти можливість відновлення.'],
    ['a tab that closed while its page loads', () => waitForPage({ getTab: () => ({ webContents: destroyed }) } as never, 'tab'),
      'The tab closed while waiting for the page.',
      'Вкладку закрито під час очікування сторінки.'],
    ['a tab that is gone', () => manager(null).getTab('019a0000-0000-7000-8000-000000000001'),
      'Tab not found: 019a0000-0000-7000-8000-000000000001',
      'Вкладка більше недоступна.'],
    ['no active tab', () => manager(null).getTab(),
      'There is no active tab',
      'Немає активної вкладки.'],
    // Address bar navigation
    ['Home typed into a website tab', () => navigate({ getTab: () => ({ mcpGroupId: 'workspace' }), searchEngine: () => undefined } as never, 'hronaut://home/'),
      'Hronaut Home is a human application page and cannot be opened inside an agent workspace.',
      'Домівка Hronaut — сторінка застосунку для людини, її не можна відкрити в робочому просторі агента.'],
    ['a site the workspace does not allow', () => assertWorkspaceNavigationAllowed(restrictedWorkspace as never, 'workspace', 'https://blocked.example/private?q=1', 'direct'),
      'Workspace navigation to https://blocked.example is blocked. Allow this origin in the trusted workspace Site access settings.',
      'Перехід до https://blocked.example у цьому робочому просторі заблоковано. Дозвольте це джерело в налаштуваннях «Доступ до сайтів» довіреного робочого простору.'],
    ['a workspace that just closed', () => assertWorkspaceNavigationAllowed({ findWorkspace: () => undefined } as never, 'workspace-id', 'https://example.test/', 'direct'),
      'Unknown workspace: workspace-id.',
      'Робочий простір більше недоступний.'],
    // Tab actions
    ['dragging Home', () => reorderTab({ getTab: (id: string) => id === 'home' ? homeTab : websiteTab } as never, 'home', 'site', 'after'),
      'Hronaut Home cannot be reordered',
      'Домівку Hronaut не можна переміщати.'],
    ['zooming past the limit', () => setZoom({ getTab: () => ({ ...websiteTab, webContents: { getZoomFactor: () => 1 } }) } as never, { action: 'set', percent: 401 }),
      'Page zoom percent must be an integer from 50 to 400',
      'Масштаб сторінки має бути цілим числом від 50 до 400 відсотків.'],
    ['freezing Home', () => controlPageLifecycle({ getTab: () => homeTab } as never, 'home', 'frozen'),
      'Only live page tabs can be frozen or resumed.',
      'Заморожувати й відновлювати можна лише вкладки із запущеними сторінками.'],
    ['unlocking a public observer page', () => setTabHumanInteractionLocked({
      findTab: () => undefined,
      getTab: () => ({ ...websiteTab, mcpGroupId: 'observer' }),
      findWorkspace: () => ({ contextClass: 'public-observer' }),
      isDestroyed: () => false,
      interactionLockTail: () => Promise.resolve(),
      writeInteractionLockTail: () => undefined,
      nativeInputLockMutations: () => 0,
      writeNativeInputLockMutations: () => undefined
    } as never, 'site', false),
    'Page input remains locked in a read-only public observer workspace.',
    'У робочому просторі публічного спостерігача, доступному лише для читання, введення на сторінці залишається заблокованим.'],
    ['bookmarking a local file', () => new BookmarkStore('/nonexistent/bookmarks.json').add({ url: 'file:///home/me/notes.txt', title: 'Notes' }),
      'Bookmark URL must be an HTTP or HTTPS address within 4,096 encoded characters',
      'Адреса закладки має бути адресою HTTP або HTTPS довжиною до 4096 закодованих символів.'],
    // Selecting a tab
    ['a tab whose renderer is gone', () => selectTabAndWait({ getTab: () => ({ ...websiteTab, webContents: destroyed }) } as never, 'site'),
      'This tab renderer is no longer available. Close the tab and reopen it from Recently closed.',
      'Ця вкладка більше не працює. Закрийте її та відкрийте знову з нещодавно закритих.'],
    // New tabs
    ['the tab limit', () => createNewTab({ options: () => ({}), tabs: () => ({ size: MAX_BROWSER_TABS }) } as never, { url: 'https://example.test/' }, true),
      `Tab limit reached (${MAX_BROWSER_TABS})`,
      `Досягнуто ліміту вкладок (${MAX_BROWSER_TABS}).`],
    ['a new tab in a workspace that just closed', () => requireMcpTabGroup({ mcpTabGroups: () => new Map() } as never, 'workspace-id'),
      'Unknown workspace: workspace-id. List workspaces with browser_workspaces or create one first.',
      'Робочий простір більше недоступний.'],
    ['a workspace being archived', () => assertWorkspaceIdle({
      workspaceOperations: () => new Map([['workspace', { action: 'archiving the workspace', blocksNewTabs: true, token: Symbol('archive') }]]),
      mcpTabGroups: () => new Map([['workspace', { name: 'Research' }]])
    } as never, 'workspace'),
    'Workspace "Research" is busy archiving the workspace. Try again after that operation finishes.',
    'Робочий простір «Research» зараз архівується. Спробуйте ще раз, коли це завершиться.']
  ] as const)('%s keeps its English message and reaches the shell in the interface language', async (_name, action, inEnglish, inUkrainian) => {
    const error = await failure(action)
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe(inEnglish)
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(inEnglish)
  })

  it('keeps the busy message agents read for every workspace operation', () => {
    for (const action of [
      'archiving the workspace', 'closing the workspace', 'forking workspace data', 'restoring the archived workspace',
      'clearing website data', 'moving workspace data', 'copying workspace data', 'importing browser cookies', 'reticulating splines'
    ]) {
      const access = {
        workspaceOperations: () => new Map([['workspace', { action, blocksNewTabs: true, token: Symbol(action) }]]),
        mcpTabGroups: () => new Map([['workspace', { name: 'Research' }]])
      }
      expect(() => assertWorkspaceIdle(access as never, 'workspace')).toThrow(`Workspace "Research" is busy ${action}. Try again after that operation finishes.`)
    }
  })
})
