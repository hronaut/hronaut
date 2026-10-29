import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenWorkspaceOperationAction, WorkspaceOperationAction } from '../src/main/browser/workspace-operations/workspace-operations-access.js'

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open) }
})

const { LocalizedError, withTranslatedIpcErrors } = await import('../src/main/localized-error.js')
const { translate } = await import('../src/shared/i18n.js')
const { MAX_BROWSER_TABS } = await import('../src/shared/types.js')
const { Browser } = await import('../src/main/browser/browser.js')
const { RendererExitedError } = await import('../src/main/browser/renderer-exit-guard.js')
const { WorkspaceMetadataError } = await import('../src/main/browser/tab-store.js')
const { waitForPage } = await import('../src/main/browser/page-waits/page-waits.js')
const { navigate } = await import('../src/main/browser/page-navigation/page-navigation.js')
const { assertWorkspaceNavigationAllowed } = await import('../src/main/browser/workspace-navigation/workspace-navigation.js')
const { reorderTab } = await import('../src/main/browser/tab-arrangement/tab-arrangement.js')
const { setZoom } = await import('../src/main/browser/page-zoom/page-zoom.js')
const { controlPageLifecycle } = await import('../src/main/browser/page-lifecycle/page-lifecycle.js')
const { setTabHumanInteractionLocked } = await import('../src/main/browser/interaction-lock/interaction-lock.js')
const { BookmarkStore } = await import('../src/main/bookmarks-history/bookmark-store.js')
const { selectTabAndWait } = await import('../src/main/browser/tab-selection/tab-selection.js')
const { createNewTab } = await import('../src/main/browser/new-tabs/new-tabs.js')
const { requireMcpTabGroup } = await import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')
const { assertWorkspaceIdle, withSavedWorkspaceOperation, withWorkspaceOperation } = await import('../src/main/browser/workspace-operations/workspace-operations.js')
const { setWorkspacePinned } = await import('../src/main/browser/mcp-tab-groups/workspace-pinning.js')
const { closeMcpTabGroupInternal } = await import('../src/main/browser/mcp-tab-groups/close-mcp-tab-group.js')
const { closeWorkspaceForPerson } = await import('../src/main/browser/workspace-archive/workspace-archive.js')
const { sleepWorkspaceTabs } = await import('../src/main/browser/tab-sleep/tab-sleep.js')
const { listWorkspaceStorageOrigins, workspaceSession } = await import('../src/main/browser/workspace-data/workspace-data.js')
const { assertTabLabelAdmission, saveTabLabel } = await import('../src/main/browser/tab-labels/tab-labels.js')
const { pickElement } = await import('../src/main/browser/element-picker/element-picker.js')
const { captureScreenshotArea } = await import('../src/main/browser/screenshot-area/screenshot-area.js')
const { withDebugger } = await import('../src/main/browser/debugger-lease/debugger-lease.js')
const { savePdf } = await import('../src/main/browser/pdf-export/pdf-export.js')
const { writeUniqueDownloadFile } = await import('../src/main/browser/unique-download-file.js')
const { getTabOverviewPagePreview } = await import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')
const { normalizedWorkspaceName } = await import('../src/main/browser/mcp-tab-groups/mcp-tab-groups.js')
const { deleteSavedTabGroup } = await import('../src/main/browser/workspace-archive/workspace-archive.js')
const { withGlobalWorkspaceStorageOperation } = await import('../src/main/browser/workspace-operations/workspace-operations.js')
const { WorkspaceRegistry } = await import('../src/main/browser/workspace-registry.js')
const { transferWorkspaceStorage } = await import('../src/main/browser/workspace-data/workspace-data.js')
const { canonicalizeWorkspaceNavigationRule } = await import('../src/main/browser/workspace-navigation-policy.js')
const { armWorkspaceContinuity } = await import('../src/main/browser/workspace-continuity/workspace-continuity.js')
const { WorkspaceTemplateImporter } = await import('../src/main/browser/workspace-template-import.js')
const { registerWorkspacesIpc } = await import('../src/main/workspaces-ipc.js')
const { registerSettingsIpc } = await import('../src/main/settings/settings-ipc.js')
const { StartupLaunchManager } = await import('../src/main/startup-launch.js')
const { createMcpRuntime } = await import('../src/main/mcp-runtime/mcp-runtime.js')
const { ReleaseHistoryService } = await import('../src/main/updates/release-history.js')
const { commitRuntimeSetting } = await import('../src/main/settings/runtime-setting-commit.js')
const { HumanWaitingService } = await import('../src/main/mcp/human-waiting-service.js')
const { WorkspaceContinuityStore } = await import('../src/main/mcp/workspace-continuity-store.js')
const { screenshot } = await import('../src/main/browser/screenshots/screenshots.js')

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
const manager = (activeTabId: string | null) => Object.assign(Object.create(Browser.prototype), { tabs: new Map(), activeTabId }) as InstanceType<typeof Browser>
const noWorkspaces = { mcpTabGroups: () => new Map(), savedTabGroups: () => new Map() }
const labels = {
  initialized: () => true, isDestroyed: () => false, tabLabelAdmissionClosed: () => false, tabLabelLifecycleHolds: () => 0,
  pendingTabLabels: () => new Set()
}
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
      'Ця вкладка більше не працює. Закрийте її та відкрийте знову в розділі «Нещодавно закриті».'],
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
    'Робочий простір «Research» зараз архівується. Спробуйте ще раз, коли це завершиться.'],
    // Workspaces that closed while the person acted on them
    ['pinning a workspace that just closed', () => setWorkspacePinned(noWorkspaces as never, 'workspace-id', true),
      'Unknown workspace: workspace-id', 'Робочий простір більше недоступний.'],
    ['closing a workspace that just closed', () => closeMcpTabGroupInternal({ ...noWorkspaces, withTabLabelLifecycle: (run: () => unknown) => run() } as never, 'workspace-id'),
      'Unknown workspace: workspace-id.', 'Робочий простір більше недоступний.'],
    ['closing a workspace with Undo that just closed', () => closeWorkspaceForPerson(noWorkspaces as never, 'workspace-id'),
      'Unknown workspace: workspace-id.', 'Робочий простір більше недоступний.'],
    ['the menu of a workspace that just closed', () => Object.assign(Object.create(Browser.prototype), { mcpTabGroups: new Map() }).showWorkspaceContextMenu('workspace-id'),
      'Unknown workspace: workspace-id', 'Робочий простір більше недоступний.'],
    ['putting the tabs of a workspace that just closed to sleep', () => sleepWorkspaceTabs(noWorkspaces as never, 'workspace-id'),
      'Unknown workspace: workspace-id', 'Робочий простір більше недоступний.'],
    ['the site data of a workspace that just closed', () => listWorkspaceStorageOrigins(noWorkspaces as never, 'workspace-id'),
      'Unknown workspace: workspace-id.', 'Робочий простір більше недоступний.'],
    ['the session of a workspace that just closed', () => workspaceSession(noWorkspaces as never, 'workspace-id'),
      'Unknown workspace: workspace-id.', 'Робочий простір більше недоступний.'],
    ['an operation on a workspace that just closed', () => withWorkspaceOperation(noWorkspaces as never, 'workspace-id', 'clearing website data', async () => undefined),
      'Unknown workspace: workspace-id.', 'Робочий простір більше недоступний.'],
    ['an operation on an archived workspace that was just deleted', () => withSavedWorkspaceOperation(noWorkspaces as never, 'workspace-id', 'deleting the archived workspace', async () => undefined),
      'Unknown archived workspace: workspace-id.', 'Архівний робочий простір більше недоступний.'],
    // Tab labels
    ['a label edit while a tab operation runs', () => assertTabLabelAdmission({ ...labels, tabLabelLifecycleHolds: () => 1 } as never),
      'Wait for the tab operation to finish before editing its label.',
      'Дочекайтеся завершення дії з вкладкою, перш ніж змінювати її мітку.'],
    ['too many label edits at once', () => assertTabLabelAdmission({ ...labels, pendingTabLabels: () => ({ size: 8 }) } as never),
      'Wait for pending label edits to finish.',
      'Дочекайтеся збереження попередніх змін міток.'],
    ['labeling Hronaut Home', () => saveTabLabel({ ...labels, getTab: () => homeTab } as never, 'home', 'Dashboard'),
      'Hronaut Home cannot be labeled.',
      'Домівці Hronaut не можна задати мітку.'],
    ['labeling a tab that closed before the label was saved', () => saveTabLabel({
      ...labels, getTab: () => websiteTab, findTab: () => undefined, store: () => ({ save: (snapshot: () => unknown) => Promise.resolve().then(snapshot) })
    } as never, 'site', 'Research'),
    'The tab is no longer available.',
    'Вкладка більше недоступна.']
  ] as const)('%s keeps its English message and reaches the shell in the interface language', async (_name, action, inEnglish, inUkrainian) => {
    const error = await failure(action)
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe(inEnglish)
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(inEnglish)
  })

  it('keeps the busy message agents read for every open workspace operation and gives each its own sentence', () => {
    // Every action an open workspace can be busy with; a new one does not compile until it is listed here.
    const actions = {
      'archiving the workspace': true, 'closing the workspace': true, 'forking workspace data': true, 'restoring the archived workspace': true,
      'clearing website data': true, 'moving workspace data': true, 'copying workspace data': true, 'importing browser cookies': true
    } satisfies Record<OpenWorkspaceOperationAction, true>
    const sentences = new Set<string>()
    for (const action of Object.keys(actions) as OpenWorkspaceOperationAction[]) {
      const access = {
        workspaceOperations: () => new Map([['workspace', { action, blocksNewTabs: true, token: Symbol(action) }]]),
        mcpTabGroups: () => new Map([['workspace', { name: 'Research' }]])
      }
      const error = (() => { try { assertWorkspaceIdle(access as never, 'workspace') } catch (caught) { return caught } })()
      expect(error).toBeInstanceOf(LocalizedError)
      expect((error as Error).message).toBe(`Workspace "Research" is busy ${action}. Try again after that operation finishes.`)
      sentences.add(ukrainian((error as InstanceType<typeof LocalizedError>).key, { name: 'Research' }))
    }
    expect(sentences.size).toBe(Object.keys(actions).length)
  })
})

const exportDirectories: string[] = []
afterEach(async () => {
  vi.mocked(open).mockReset().mockImplementation((await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open)
  await Promise.all(exportDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** The handler a module registers for a channel, called as the shell calls it. */
async function invokeRegistered(register: (handle: (channel: string, listener: Parameters<IpcMain['handle']>[1]) => void) => void, channel: string, ...args: unknown[]): Promise<unknown> {
  const handlers = new Map<string, Parameters<IpcMain['handle']>[1]>()
  register((name, listener) => { handlers.set(name, listener) })
  return handlers.get(channel)!({ senderFrame: { url: SHELL_URL } } as unknown as IpcMainInvokeEvent, ...args)
}

const sleepingTab = {
  ...websiteTab, sleeping: true, navigationGeneration: 0,
  webContents: { id: 7, isDestroyed: () => false, isLoadingMainFrame: () => false }
}
const research = { id: 'research', name: 'Research', storageId: 'research-storage', origins: [] }
const archivedResearch = { ...research, id: 'saved', tabs: [{ title: 'Docs', url: 'https://docs.example/', pinned: false }] }
const busyListener = (code: string) => ({
  setPaused: () => undefined,
  start: () => Promise.reject(Object.assign(new Error(`listen ${code}: address already in use 127.0.0.1:13001`), { code })),
  stop: async () => undefined
})
const mcpRuntimeHost = {
  assertWorkspaceInitialized: () => undefined,
  state: { host: '127.0.0.1', port: 13000, status: 'ready' },
  createServer: () => busyListener('EADDRINUSE')
}
const templateText = JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'linux', workspaces: [{ name: 'Research', color: 'blue', startPages: [] }] })

describe('main-process failures people see in page tools, workspace management and settings', () => {
  it.each([
    // Page tools
    ['selecting an element on Home', () => pickElement({ getTab: () => homeTab } as never),
      'Open a website tab before selecting an element',
      'Відкрийте вкладку з вебсайтом, щоб вибрати елемент.'],
    ['capturing an area of Home', () => captureScreenshotArea({ getTab: () => homeTab } as never),
      'Open a website tab before capturing an area',
      'Відкрийте вкладку з вебсайтом, щоб зробити знімок області.'],
    ['a page tool while Developer Tools are open', () => withDebugger({
      inDebuggerQueue: (_id: number, run: () => unknown) => run(), dialogMonitorAttach: async () => undefined, isDevToolsOpening: () => false
    } as never, { id: 7, isDevToolsOpened: () => true } as never, async () => undefined),
    'Close Developer Tools for this tab before using this MCP action',
    'Закрийте інструменти розробника для цієї вкладки й спробуйте ще раз.'],
    ['a PDF of a tab that closed', () => savePdf({
      getTab: () => ({ ...websiteTab, title: 'Page', navigationGeneration: 0, webContents: { isDestroyed: () => true, removeListener: () => undefined } }),
      pdfFilename: () => 'Page.pdf', isDestroyed: () => false, findTab: () => undefined
    } as never),
    'The tab closed while exporting its PDF. Open the page and export again.',
    'Вкладку закрито під час експорту PDF. Відкрийте сторінку й експортуйте її знову.'],
    ['an export when the disk is full', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'hronaut-translated-export-'))
      exportDirectories.push(directory)
      vi.mocked(open).mockRejectedValueOnce(Object.assign(new Error('ENOSPC: no space left on device, open'), { code: 'ENOSPC', errno: -28, syscall: 'open' }))
      return writeUniqueDownloadFile(directory, 'Private title.pdf', Buffer.from('%PDF'))
    },
    'ENOSPC: no space left on device, open',
    'Недостатньо місця на диску, щоб зберегти файл (ENOSPC).'],
    // Tab search page previews
    ['a full-page preview of a sleeping tab', () => getTabOverviewPagePreview({
      getTab: () => sleepingTab, findTab: () => sleepingTab, isDestroyed: () => false, window: () => ({ isDestroyed: () => false })
    } as never, 'site'),
    'Wake this tab before requesting a full-page preview.',
    'Пробудіть цю вкладку, перш ніж запитувати перегляд усієї сторінки.'],
    // Workspace management
    ['an empty workspace name', () => normalizedWorkspaceName('   '),
      'Workspace name cannot be empty.',
      'Назва робочого простору не може бути порожньою.'],
    ['a workspace name already in use', () => Object.assign(Object.create(Browser.prototype), {
      mcpTabGroups: new Map([['research', research]]), savedTabGroups: new Map()
    }).assertWorkspaceNameAvailable('Research'),
    'A workspace named "Research" already exists. Workspace names must be unique.',
    'Робочий простір із назвою «Research» уже існує. Назви робочих просторів мають бути унікальними.'],
    ['closing a protected workspace with Undo', () => closeWorkspaceForPerson({ mcpTabGroups: () => new Map([['research', { ...research, deletionProtected: true }]]) } as never, 'research'),
      'Workspace "Research" is protected from deletion. Turn off deletion protection in workspace settings first.',
      'Робочий простір «Research» захищено від видалення. Спершу вимкніть захист від видалення в налаштуваннях робочого простору.'],
    ['deleting a protected archived workspace', () => deleteSavedTabGroup({
      withSavedWorkspaceOperation: (_id: string, _action: string, run: () => unknown) => run(),
      savedTabGroups: () => new Map([['saved', { ...archivedResearch, deletionProtected: true }]])
    } as never, 'saved'),
    'Workspace "Research" is protected from deletion. Turn off deletion protection in Home first.',
    'Робочий простір «Research» захищено від видалення. Спершу вимкніть захист від видалення в Домівці.'],
    ['an archived workspace that is being restored', () => withSavedWorkspaceOperation({
      savedTabGroups: () => new Map([['saved', archivedResearch]]),
      savedWorkspaceOperations: () => new Map([['saved', { action: 'restoring the archived workspace', blocksNewTabs: true, token: Symbol('restore') }]])
    } as never, 'saved', 'deleting the archived workspace', async () => undefined),
    'Archived workspace "Research" is busy restoring the archived workspace. Try again after that operation finishes.',
    'Робочий простір «Research» зараз відновлюється з архіву. Спробуйте ще раз, коли це завершиться.'],
    ['workspace storage while data is being copied', () => withGlobalWorkspaceStorageOperation({
      workspaceStorageOperation: () => ({ action: 'copying workspace data', blocksNewTabs: false, token: Symbol('copy') })
    } as never, 'clearing website data', async () => undefined),
    'Workspace storage is busy copying workspace data. Try again after that operation finishes.',
    'Сховище робочих просторів зайняте: зараз копіюються дані робочого простору. Спробуйте ще раз, коли це завершиться.'],
    ['restoring past the tab limit', () => {
      const registry = new WorkspaceRegistry({
        withArchivedOperation: (_id: string, _action: string, run: () => unknown) => run(),
        assertRestoreCapacity: () => undefined,
        tabs: () => ({ length: MAX_BROWSER_TABS }),
        maxTabs: MAX_BROWSER_TABS
      } as never)
      registry.archived.set('saved', archivedResearch as never)
      return registry.restore('saved')
    },
    `Restoring "Research" would exceed the ${MAX_BROWSER_TABS}-tab limit.`,
    `Відновлення «Research» перевищить ліміт вкладок (${MAX_BROWSER_TABS}).`],
    ['moving data out of an open workspace', () => transferWorkspaceStorage({
      mcpTabGroups: () => new Map([['research', research], ['work', { ...research, id: 'work', name: 'Work' }]]),
      savedTabGroups: () => new Map(),
      isClosingWorkspace: () => false
    } as never, { sourceWorkspaceId: 'research', targetWorkspaceId: 'work', mode: 'move' }),
    'Archive both workspaces before moving data, or choose Copy to keep their pages open.',
    'Заархівуйте обидва робочі простори, перш ніж переміщувати дані, або виберіть «Копіювати», щоб їхні сторінки залишилися відкритими.'],
    ['a Site access rule with credentials', () => canonicalizeWorkspaceNavigationRule('https://person:secret@example.com'),
      'Navigation rules cannot contain credentials.',
      'Правила доступу до сайтів не можуть містити облікові дані.'],
    ['a checkpoint while workspace actions are pending', () => armWorkspaceContinuity({ continuityActions: () => new Set(['research']) } as never, 'research'),
      'Wait for pending workspace actions before creating a checkpoint',
      'Дочекайтеся завершення дій у робочому просторі, перш ніж створювати контрольну точку.'],
    ['importing a template whose names collide', () => new WorkspaceTemplateImporter({ existingWorkspaces: () => [research] } as never).import(templateText),
      'Resolve workspace name collisions before importing.',
      'Перед імпортом усуньте збіги назв робочих просторів.'],
    ['waiting decisions before the agent service starts', () => invokeRegistered((handle) => registerWorkspacesIpc({
      assertTrustedSender: () => undefined, handleBrowserIpc: handle, humanWaiting: () => null
    } as never), 'browser:list-human-waiting', 'research'),
    'Waiting workspace unavailable',
    'Робочий простір, що очікує, недоступний.'],
    // Settings
    ['launch at sign-in before startup integration is ready', () => invokeRegistered((handle) => registerSettingsIpc({ handle } as never, {
      assertTrustedSender: () => undefined, handleBrowserIpc: handle, startupLaunchManager: () => null
    } as never), 'settings:set-launch-at-startup', true),
    'Startup integration is unavailable',
    'Запуск разом із системою недоступний.'],
    ['launch at sign-in on an unsupported system', () => new StartupLaunchManager({ isPackaged: true, platform: 'freebsd' } as never).setEnabled(true),
      'Launch at sign-in is not supported on this operating system',
      'Запуск після входу в систему не підтримується в цій операційній системі.'],
    ['an MCP port below 1024', () => createMcpRuntime(mcpRuntimeHost as never).setMcpPort(80),
      'MCP port must be an integer from 1024 through 65535',
      'Порт MCP має бути цілим числом від 1024 до 65535.'],
    ['an MCP port another app uses', () => createMcpRuntime(mcpRuntimeHost as never).setMcpPort(13001),
      'Could not listen on 127.0.0.1:13001: listen EADDRINUSE: address already in use 127.0.0.1:13001',
      'Не вдалося слухати 127.0.0.1:13001, бо цей порт зайнятий іншим застосунком.'],
    ['release history while offline', () => new ReleaseHistoryService({ fetch: async () => { throw new TypeError('fetch failed') } }).getPage(1),
      'Could not load release history from GitHub.',
      'Не вдалося завантажити історію випусків із GitHub.'],
    ['a runtime setting that could be neither saved nor restored', () => commitRuntimeSetting({
      previous: 'off', next: 'on',
      apply: (value) => { if (value === 'off') throw new Error('rollback failed') },
      persist: async () => { throw new Error('disk failed') }
    }),
    'The runtime setting could not be persisted or restored',
    'Не вдалося зберегти налаштування або відновити попереднє значення.']
  ] as const)('%s keeps its English message and reaches the shell in the interface language', async (_name, action, inEnglish, inUkrainian) => {
    const error = await failure(action)
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe(inEnglish)
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(inEnglish)
  })

  it('keeps the file system details of a failed export and leaves its name out of the sentence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-translated-export-'))
    exportDirectories.push(directory)
    // Node's message names the path, as it does when the download folder refuses the file.
    const path = join(directory, 'Private title.pdf')
    const denied = Object.assign(new Error(`EACCES: permission denied, open '${path}'`), { code: 'EACCES', errno: -13, syscall: 'open', path })
    vi.mocked(open).mockRejectedValueOnce(denied)
    const error = await failure(() => writeUniqueDownloadFile(directory, 'Private title.pdf', Buffer.from('%PDF')))
    expect(error).toMatchObject({ message: denied.message, code: 'EACCES', errno: -13, syscall: 'open', path: denied.path, cause: denied })
    expect((error as Error).message).toContain('Private title')
    const shown = await shownTo(SHELL_URL, error)
    expect(shown).toBe('Hronaut не має дозволу зберігати файли в папці завантажень (EACCES).')
    expect(shown).not.toContain('Private title')
  })

  it('keeps the busy message agents read for every archived workspace and storage operation and gives each its own sentence', async () => {
    // Every action that can hold an archived workspace or all workspace storage; a new one does not compile until it is listed here.
    const actions = {
      'archiving the workspace': true, 'closing the workspace': true, 'forking workspace data': true, 'restoring the archived workspace': true,
      'deleting the archived workspace': true, 'clearing website data': true, 'moving workspace data': true, 'copying workspace data': true,
      'importing browser cookies': true
    } satisfies Record<WorkspaceOperationAction, true>
    const archivedSentences = new Set<string>()
    const storageSentences = new Set<string>()
    for (const action of Object.keys(actions) as WorkspaceOperationAction[]) {
      const operation = { action, blocksNewTabs: true, token: Symbol(action) }
      const archived = await failure(() => withSavedWorkspaceOperation({
        savedTabGroups: () => new Map([['saved', archivedResearch]]), savedWorkspaceOperations: () => new Map([['saved', operation]])
      } as never, 'saved', 'restoring the archived workspace', async () => undefined))
      const storage = await failure(() => withGlobalWorkspaceStorageOperation({ workspaceStorageOperation: () => operation } as never, 'clearing website data', async () => undefined))
      expect(archived).toBeInstanceOf(LocalizedError)
      expect(storage).toBeInstanceOf(LocalizedError)
      expect((archived as Error).message).toBe(`Archived workspace "Research" is busy ${action}. Try again after that operation finishes.`)
      expect((storage as Error).message).toBe(`Workspace storage is busy ${action}. Try again after that operation finishes.`)
      archivedSentences.add(ukrainian((archived as InstanceType<typeof LocalizedError>).key, { name: 'Research' }))
      storageSentences.add(ukrainian((storage as InstanceType<typeof LocalizedError>).key))
    }
    expect(archivedSentences.size).toBe(Object.keys(actions).length)
    expect(storageSentences.size).toBe(Object.keys(actions).length)
  })
})

const waitingWorkspaceId = '0198dc5b-4192-7000-8000-000000000001'
const waitingInput = {
  workspaceId: waitingWorkspaceId, runId: '0198dc5b-4192-7000-8000-000000000002',
  decision: 'review-page' as const, owner: 'local-operator', fallbackOwner: 'local-operator',
  timeoutMs: 60_000, priorOutcome: 'NONE' as const
}
const tabBoundApproval = {
  ...waitingInput, decision: 'approve-action' as const,
  review: {
    toolName: 'browser_click', actionClass: 'interact' as const, reversibility: 'unknown' as const,
    representation: 'bounded-description' as const, description: 'Submit the visible form',
    artifactHash: 'a'.repeat(64), sessionBinding: 'b'.repeat(64), workspaceName: 'QA', profileName: 'Full access',
    tabId: '0198dc5b-4192-7000-8000-000000000004', browserSessionGeneration: 6
  }
}
const authorized = () => undefined
const goneDecisionId = '0198dc5b-4192-7000-8000-000000000009'

/** A waiting service whose history saves, until save number `failingSave` fails. */
function waitingService(failingSave = Number.POSITIVE_INFINITY): InstanceType<typeof HumanWaitingService> {
  let saves = 0
  return new HumanWaitingService({ load: async () => null, save: async () => { if (++saves >= failingSave) throw new Error('ENOSPC: no space left on device') } })
}

const checkpointEvidence = { epoch: 'epoch', workspaceId: 'research', tabId: 'tab', originDigest: 'origin', policyDigest: 'policy', navigationGeneration: 0, humanInteractionGeneration: 0 }

/** A continuity store whose checkpoint for Research waits for review, with the review it read last. */
function suspendedCheckpoint(outcome: 'NONE' | 'OUTCOME_UNKNOWN') {
  const clock = { now: 1000 }
  const store = new WorkspaceContinuityStore(100, () => clock.now)
  store.arm(checkpointEvidence)
  store.suspend('research', outcome)
  return { store, clock, reviewId: store.inspect('research', checkpointEvidence, true).reviewId! }
}

describe('main-process failures people see in continuity checkpoints and waiting decisions', () => {
  it.each([
    // Waiting decisions
    ['waiting decisions whose history cannot be read', () => new HumanWaitingService({ load: async () => { throw new Error('EACCES: permission denied') }, save: async () => undefined }).list(waitingWorkspaceId, authorized),
      'Human waiting history is unavailable',
      'Історія рішень людини недоступна.'],
    ['an answer that could not be saved', async () => {
      const service = waitingService(2)
      const record = await service.create(waitingInput, authorized)
      return service.change(waitingWorkspaceId, record.id, record.revision, 'cancel', authorized)
    },
    'Human waiting change could not be saved; inspect recovery before retrying',
    'Не вдалося зберегти зміну рішення; перевірте відновлення, перш ніж повторити спробу.'],
    ['waiting decisions after an answer could not be saved', async () => {
      const service = waitingService(2)
      const record = await service.create(waitingInput, authorized)
      await service.change(waitingWorkspaceId, record.id, record.revision, 'cancel', authorized).catch(() => undefined)
      return service.list(waitingWorkspaceId, authorized)
    },
    'Human waiting history is unavailable',
    'Історія рішень людини недоступна.'],
    ['a note on an acknowledgement', async () => {
      const service = waitingService()
      const record = await service.create(waitingInput, authorized)
      return service.change(waitingWorkspaceId, record.id, record.revision, 'acknowledge', authorized, undefined, undefined, { note: 'Seen' })
    },
    'Waiting decision note unavailable',
    'Примітка до рішення, на яке очікують, недоступна.'],
    ['answering a decision that is gone', () => waitingService().change(waitingWorkspaceId, goneDecisionId, goneDecisionId, 'cancel', authorized),
      'Waiting decision unavailable',
      'Рішення, на яке очікують, недоступне.'],
    ['a decision that is gone when it is read back', () => waitingService().notify(waitingWorkspaceId, goneDecisionId, authorized, async () => undefined),
      'Waiting decision unavailable',
      'Рішення, на яке очікують, недоступне.'],
    ['answering a decision that changed since it was shown', async () => {
      const service = waitingService()
      const record = await service.create(waitingInput, authorized)
      return service.change(waitingWorkspaceId, record.id, goneDecisionId, 'cancel', authorized)
    },
    'Waiting decision unavailable or stale',
    'Рішення, на яке очікують, недоступне або застаріло.'],
    ['approving a tab-bound action without confirming its account and target', async () => {
      const service = waitingService()
      const record = await service.create(tabBoundApproval, authorized)
      return service.change(waitingWorkspaceId, record.id, record.revision, 'resolve', authorized, async () => undefined)
    },
    'Confirm the signed-in account and target in the trusted review UI',
    'Підтвердьте, що перевірили обліковий запис, у який виконано вхід, і видиму ціль у пов’язаній вкладці браузера.'],
    ['a page that changed while the review was saved', async () => {
      let checks = 0
      const service = waitingService()
      const record = await service.create(waitingInput, authorized)
      return service.change(waitingWorkspaceId, record.id, record.revision, 'resolve', authorized, async () => { if (++checks === 2) throw new Error('page changed') })
    },
    'Browser review changed while saving; inspect current state again',
    'Стан браузера змінився під час збереження перевірки; перевірте поточний стан ще раз.'],
    // Continuity checkpoints
    ['a new checkpoint while the last one waits for review', () => suspendedCheckpoint('NONE').store.arm(checkpointEvidence),
      'Reconcile the suspended checkpoint before replacing it',
      'Підтвердьте перевірений стан, перш ніж створювати нову контрольну точку.'],
    ['a checkpoint once every checkpoint place is taken', () => {
      const store = new WorkspaceContinuityStore(1)
      store.arm({ ...checkpointEvidence, workspaceId: 'work' })
      return store.arm(checkpointEvidence)
    },
    'Continuity checkpoint capacity reached',
    'Досягнуто ліміту контрольних точок.'],
    ['confirming a review that a newer one replaced', () => suspendedCheckpoint('NONE').store.reconcile('research', goneDecisionId, checkpointEvidence, true, false),
      'Continuity review is unavailable or stale',
      'Перевірка стану робочого простору недоступна або застаріла.'],
    ['confirming a review after 30 seconds', () => {
      const { store, clock, reviewId } = suspendedCheckpoint('NONE')
      clock.now += 30_000
      return store.reconcile('research', reviewId, checkpointEvidence, true, false)
    },
    'Continuity review expired; inspect current state again',
    'Час перевірки стану робочого простору минув; перевірте поточний стан ще раз.'],
    ['confirming a review after the person used the page', () => {
      const { store, reviewId } = suspendedCheckpoint('NONE')
      return store.reconcile('research', reviewId, { ...checkpointEvidence, humanInteractionGeneration: 1 }, true, false)
    },
    'Browser state changed after continuity review',
    'Стан браузера змінився після перевірки стану робочого простору.'],
    ['confirming a review without accepting that the earlier action may have taken effect', () => {
      const { store, reviewId } = suspendedCheckpoint('OUTCOME_UNKNOWN')
      return store.reconcile('research', reviewId, checkpointEvidence, true, false)
    },
    'Explicitly acknowledge the unresolved prior outcome',
    'Підтвердьте, що сторінку перевірено й що попередня дія вже могла мати наслідки.'],
    // Workspaces
    ['a busy workspace whose record is already gone', () => assertWorkspaceIdle({
      workspaceOperations: () => new Map([['019a0000-0000-7000-8000-000000000001', { action: 'closing the workspace', blocksNewTabs: true, token: Symbol('close') }]]),
      mcpTabGroups: () => new Map()
    } as never, '019a0000-0000-7000-8000-000000000001'),
    'Workspace "019a0000-0000-7000-8000-000000000001" is busy closing the workspace. Try again after that operation finishes.',
    'Цей робочий простір зараз зайнятий іншою дією. Спробуйте ще раз, коли це завершиться.']
  ] as const)('%s keeps its English message and reaches the shell in the interface language', async (_name, action, inEnglish, inUkrainian) => {
    const error = await failure(action)
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe(inEnglish)
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(inEnglish)
  })

  it('names a busy archived workspace by the archive it checked, never by its internal ID', async () => {
    // The archive is read once, so a busy one is named even if a second lookup would no longer find it.
    const savedId = '019a0000-0000-7000-8000-000000000002'
    let reads = 0
    const error = await failure(() => withSavedWorkspaceOperation({
      savedTabGroups: () => reads++ === 0 ? new Map([[savedId, { ...archivedResearch, id: savedId }]]) : new Map(),
      savedWorkspaceOperations: () => new Map([[savedId, { action: 'deleting the archived workspace', blocksNewTabs: true, token: Symbol('delete') }]])
    } as never, savedId, 'restoring the archived workspace', async () => undefined))
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe('Archived workspace "Research" is busy deleting the archived workspace. Try again after that operation finishes.')
    const shown = await shownTo(SHELL_URL, error)
    expect(shown).toBe('Архівний робочий простір «Research» зараз видаляється. Спробуйте ще раз, коли це завершиться.')
    expect(shown).not.toContain(savedId)
  })
})

describe('translated failures keep the English and the cause agents and logs read', () => {
  const elementTab = { id: 'site', loading: false, navigationGeneration: 0, webContents: { executeJavaScript: vi.fn() } }
  const screenshots = {
    getTab: () => elementTab, validateTarget: () => undefined,
    withRenderableTab: (_tab: unknown, run: () => unknown) => run(), dismissAgentPointer: async () => undefined
  }

  it.each([
    ['gone', 'Screenshot target not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.', 'Елемента більше немає на сторінці. Виберіть його ще раз.'],
    ['hidden', 'Screenshot target has no visible area.', 'Вибраний елемент не має видимої області.']
  ])('keeps the page script error for an element screenshot target that is %s', async (_state, pageError, inUkrainian) => {
    const rejected = new Error(`Error: ${pageError}`)
    elementTab.webContents.executeJavaScript.mockRejectedValueOnce(rejected)
    const error = await failure(() => screenshot(screenshots as never, { selector: '#target' }))
    expect(error).toBeInstanceOf(LocalizedError)
    expect(error).toMatchObject({ message: rejected.message, cause: rejected })
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(rejected.message)
  })

  it('passes any other element screenshot failure through as it is', async () => {
    const rejected = new Error('Script failed to execute')
    elementTab.webContents.executeJavaScript.mockRejectedValueOnce(rejected)
    await expect(failure(() => screenshot(screenshots as never, { selector: '#target' }))).resolves.toBe(rejected)
  })

  it.each([
    ['EACCES', 'listen EACCES: permission denied 127.0.0.1:13001'],
    ['EPERM', 'listen EPERM: operation not permitted 127.0.0.1:13001']
  ])('names the listen address when the system refuses an MCP port (%s)', async (code, nodeMessage) => {
    const refused = Object.assign(new Error(nodeMessage), { code })
    const error = await failure(() => createMcpRuntime({
      ...mcpRuntimeHost,
      createServer: () => ({ setPaused: () => undefined, start: () => Promise.reject(refused), stop: async () => undefined })
    } as never).setMcpPort(13001))
    expect(error).toBeInstanceOf(LocalizedError)
    expect(error).toMatchObject({ message: `Could not listen on 127.0.0.1:13001: ${nodeMessage}`, cause: refused })
    await expect(shownTo(SHELL_URL, error)).resolves.toBe('Не вдалося слухати 127.0.0.1:13001, бо система не дозволяє Hronaut використовувати цей порт.')
    await expect(shownTo('https://site.example/', error)).resolves.toBe(`Could not listen on 127.0.0.1:13001: ${nodeMessage}`)
  })

  it('keeps the system error for an MCP port that fails for another reason', async () => {
    const unavailable = Object.assign(new Error('listen EADDRNOTAVAIL: address not available 127.0.0.1:13001'), { code: 'EADDRNOTAVAIL' })
    const error = await failure(() => createMcpRuntime({
      ...mcpRuntimeHost,
      createServer: () => ({ setPaused: () => undefined, start: () => Promise.reject(unavailable), stop: async () => undefined })
    } as never).setMcpPort(13001))
    expect(error).not.toBeInstanceOf(LocalizedError)
    expect(error).toMatchObject({ message: `Could not listen on 127.0.0.1:13001: ${unavailable.message}`, cause: unavailable })
  })

  it.each([
    ['EROFS', -30, 'read-only file system', 'Папка завантажень доступна лише для читання (EROFS).'],
    ['EDQUOT', -122, 'disk quota exceeded', 'Недостатньо місця на диску, щоб зберегти файл (EDQUOT).']
  ])('ends the sentence for an export that fails with %s with that code', async (code, errno, reason, inUkrainian) => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-translated-export-'))
    exportDirectories.push(directory)
    const path = join(directory, 'Private title.pdf')
    const refused = Object.assign(new Error(`${code}: ${reason}, open '${path}'`), { code, errno, syscall: 'open', path })
    vi.mocked(open).mockRejectedValueOnce(refused)
    const error = await failure(() => writeUniqueDownloadFile(directory, 'Private title.pdf', Buffer.from('%PDF')))
    expect(error).toBeInstanceOf(LocalizedError)
    expect(error).toMatchObject({ message: refused.message, code, errno, syscall: 'open', path, cause: refused })
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(refused.message)
  })

  it('keeps both errors of a restore that could not be rolled back as the cause', async () => {
    const createFailed = new Error('The tab could not be created')
    const closeFailed = new Error('The restored workspace could not be closed')
    const registry = new WorkspaceRegistry({
      withArchivedOperation: (_id: string, _action: string, run: () => unknown) => run(),
      withActiveOperation: (_id: string, _action: string, run: () => unknown) => run(),
      assertRestoreCapacity: () => undefined,
      tabs: () => [],
      maxTabs: MAX_BROWSER_TABS,
      createTab: async () => { throw createFailed },
      closeActive: async () => { throw closeFailed },
      remapDownloads: () => undefined,
      changed: () => undefined
    } as never)
    registry.archived.set('saved', { ...archivedResearch, navigationPolicy: { mode: 'open', rules: [] }, navigationAudit: [] } as never)
    const error = await failure(() => registry.restore('saved'))
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe('Archived workspace "Research" could not be restored or rolled back. Its recoverable active workspace remains open; close or archive it before retrying.')
    expect((error as Error).cause).toBeInstanceOf(AggregateError)
    expect(((error as Error).cause as AggregateError).errors).toEqual([createFailed, closeFailed])
    await expect(shownTo(SHELL_URL, error)).resolves.toBe('Не вдалося відновити архівний робочий простір «Research» або повернути попередній стан. Його активна копія залишається відкритою для відновлення; закрийте або заархівуйте її, перш ніж повторити спробу.')
  })
})
