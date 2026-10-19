import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpenWorkspaceOperationAction, WorkspaceOperationAction } from '../src/main/browser/workspace-operations/workspace-operations-access.js'
import type { WalletPolicy } from '../src/shared/wallet.js'

vi.mock('electron', () => ({ session: {}, WebContentsView: class {}, nativeImage: {}, shell: {}, app: { getPath: () => '/tmp' }, Menu: {} }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open) }
})

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
const { registerSettingsIpc } = await import('../src/main/settings-ipc.js')
const { StartupLaunchManager } = await import('../src/main/startup-launch.js')
const { createMcpRuntime } = await import('../src/main/mcp-runtime.js')
const { ReleaseHistoryService } = await import('../src/main/release-history.js')
const { commitRuntimeSetting } = await import('../src/main/runtime-setting-commit.js')
const { fillCredentialWhileMcpPaused } = await import('../src/main/credential-fill-pause.js')
const { CredentialStore } = await import('../src/main/credential-store.js')
const { emulate } = await import('../src/main/browser/emulation/emulation.js')
const { DEFAULT_EMULATION } = await import('../src/main/browser/emulation-state.js')
const { registerWalletIpc } = await import('../src/main/wallet/ipc.js')
const { PassphraseWalletKeyWrapper, SafeStorageWalletKeyWrapper } = await import('../src/main/wallet/key-provider.js')
const { WalletService } = await import('../src/main/wallet/service.js')
const { WALLET_RECOVERY_CANCELLED_MESSAGE, generateWalletWithRecoveryConfirmation } = await import('../src/main/wallet/onboarding.js')
const { approve: approveWalletRequest } = await import('../src/main/wallet/broker/human-approvals.js')
const { sanitizedError } = await import('../src/main/wallet/broker/sanitized-error.js')
const { walletStartupFailureStatus } = await import('../src/main/wallet/startup-status.js')

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
    ['the menu of a workspace that just closed', () => Object.assign(Object.create(BrowserTabsManager.prototype), { mcpTabGroups: new Map() }).showWorkspaceContextMenu('workspace-id'),
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
    ['a workspace name already in use', () => Object.assign(Object.create(BrowserTabsManager.prototype), {
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
    const denied = Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES', errno: -13, syscall: 'open', path: join(directory, 'Private title.pdf') })
    vi.mocked(open).mockRejectedValueOnce(denied)
    const error = await failure(() => writeUniqueDownloadFile(directory, 'Private title.pdf', Buffer.from('%PDF')))
    expect(error).toMatchObject({ message: denied.message, code: 'EACCES', errno: -13, syscall: 'open', path: denied.path, cause: denied })
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

const credentialDirectories: string[] = []
afterEach(async () => {
  await Promise.all(credentialDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

/** A saved account whose password the given secure storage reads back; it names no real person or password. */
async function savedCredential(decrypt: (store: InstanceType<typeof CredentialStore>, id: () => string) => Promise<{ result: string; shouldReEncrypt: boolean }>) {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-translated-credentials-'))
  credentialDirectories.push(directory)
  let id = ''
  const store: InstanceType<typeof CredentialStore> = new CredentialStore(join(directory, 'credentials.json'), {
    encrypt: async () => Buffer.from('sealed'),
    decrypt: () => decrypt(store, () => id)
  })
  id = (await store.save('https://accounts.example', 'person', 'placeholder')).id
  return { store, id }
}

/** A website tab whose emulation can be restored, as the Environment panel restores it. */
const emulationTab = {
  ...websiteTab, emulation: DEFAULT_EMULATION, emulationExtraHttpHeaders: {}, emulationApplication: 'unknown', networkConditionApplication: 'confirmed',
  navigationGeneration: 0, observationGeneration: 0, emulationContextGeneration: 0, networkDebuggerEpoch: 0, webContents: { isDestroyed: () => false }
}
const emulationAccess = (tab: object, findTab: () => unknown = () => tab) => ({
  getTab: () => tab, findTab, isDestroyed: () => false, requireEmulationConfirmed: () => undefined, requireNetworkConditionsKnown: () => undefined,
  withDebugger: (_webContents: unknown, run: () => unknown) => run()
})
const confirmedEmulation = BrowserTabsManager.prototype as unknown as { requireEmulationConfirmed(tab: object): void }

/** A wallet service before startup; nothing here is read from or written to disk. */
const walletService = () => new WalletService({
  directory: '/nonexistent/hronaut-wallets', platform: 'linux', safeStorage: {} as never, now: () => new Date('2026-10-19T12:00:00.000Z')
})
const walletPolicy: Omit<WalletPolicy, 'expiresAt'> = {
  id: 'policy-1', name: 'Test automation', mode: 'always-ask', walletId: 'wallet-1', workspaceId: 'workspace-1', networkIds: ['1'],
  origins: [], destinations: [], methods: [], maximumOperationCount: 1, requireSuccessfulSimulation: true, allowMessageSigning: false
}
/** A new wallet whose confirmation the person answers; its recovery phrase is left empty. */
const onboarding = (remove: () => Promise<boolean> = async () => true) => ({
  generate: async () => ({ wallet: { id: 'wallet-1' }, recoveryMaterial: '' }),
  confirmRecovery: async () => { throw new Error('confirmation storage failed') },
  remove
})
const walletIpcHost = { assertMainShellSender: () => undefined, service: () => null, broker: () => null }
const approvals = (record: unknown, lockGenerations: number[] = [0, 0]) => ({
  lockGeneration: () => lockGenerations.shift() ?? 0,
  queueLifecycle: async (operation: () => unknown) => operation(),
  service: { approvals: { get: () => record } }
})

describe('main-process failures people see in password fill, wallets and emulation', () => {
  it.each([
    // Password fill
    ['filling a password while an agent command runs', () => fillCredentialWhileMcpPaused({
      pausePersistently: () => undefined, acquireTemporaryPause: () => () => undefined, getActiveRequestCount: () => 1, fill: async () => true, timeoutMs: 0
    }),
    'Could not fill the password while an MCP command was still active',
    'Пароль не заповнено, бо команда агента ще виконувалася. Агенти залишаються призупиненими; спробуйте ще раз, коли вона завершиться.'],
    ['filling a password that was just removed', () => new CredentialStore('/nonexistent/credentials.json', {} as never).password('credential-1'),
      'Saved credential not found',
      'Збережений пароль більше недоступний.'],
    ['filling a password that changed while it was read', async () => {
      const { store, id } = await savedCredential(async (current, credentialId) => {
        await current.remove(credentialId())
        return { result: 'placeholder', shouldReEncrypt: false }
      })
      return store.password(id)
    },
    'Saved credential changed during access',
    'Збережений пароль змінився під час читання. Спробуйте ще раз.'],
    // Emulation
    ['changing emulation on Home', () => emulate({ getTab: () => homeTab } as never, { reset: true }),
      'Open a website tab before changing browser emulation',
      'Відкрийте вкладку з вебсайтом, щоб змінити емуляцію браузера.'],
    ['restoring emulation after the page navigated', () => emulate(emulationAccess(emulationTab, () => undefined) as never, { tabId: 'site', recover: true }),
      'Emulation target changed',
      'Сторінка змінилася під час застосування емуляції. Спробуйте ще раз.'],
    ['restoring emulation before Network conditions are recovered', () => emulate(emulationAccess({ ...emulationTab, networkConditionApplication: 'unknown' }) as never, { tabId: 'site', recover: true }),
      'Network application must be confirmed before changing or restoring emulation. Recover Network conditions separately.',
      'Спочатку відновіть мережеві умови в Умовах запитів, а потім змініть або відновіть емуляцію.'],
    ['a new change while the last emulation is unconfirmed', () => confirmedEmulation.requireEmulationConfirmed({ emulationApplication: 'unknown' }),
      'Native emulation application is not confirmed. Inspect retained settings and explicitly restore them before a new change; do not replay the failed request.',
      'Емуляцію не підтверджено. Відкрийте Середовище й відновіть збережені налаштування, перш ніж вносити нові зміни.'],
    // Wallet settings
    ['a wallet action before the wallet service starts', () => invokeRegistered((handle) => registerWalletIpc({ handle } as never, walletIpcHost as never), 'wallets:cancel-import', 'import-token'),
      'Wallet service is unavailable',
      'Служба гаманців недоступна.'],
    ['locking wallets before the broker starts', () => invokeRegistered((handle) => registerWalletIpc({ handle } as never, walletIpcHost as never), 'wallets:lock'),
      'Wallet broker is unavailable',
      'Служба гаманців недоступна.'],
    ['a wallet vault secure storage cannot unlock', () => new SafeStorageWalletKeyWrapper({
      decryptStringAsync: async () => { throw new Error('The keyring is locked') }
    } as never).unwrap({ mode: 'safe-storage', wrappedKey: 'AAAA' }),
    'Wallet vault unlock failed',
    'Не вдалося розблокувати сховище гаманців.'],
    ['unlocking a wallet vault with an empty passphrase', () => new PassphraseWalletKeyWrapper({} as never).unwrap({ mode: 'passphrase' } as never),
      'Wallet vault passphrase is required',
      'Потрібна парольна фраза сховища.'],
    ['setting up a passphrase the vault does not need', () => walletService().setupPassphrase(''),
      'Wallet passphrase setup is unavailable',
      'Налаштування парольної фрази сховища недоступне.'],
    ['unlocking a vault that is not locked', () => walletService().unlock(''),
      'Wallet vault is not locked',
      'Сховище гаманців не заблоковано.'],
    ['a wallet policy that already expired', () => walletService().setPolicy({ ...walletPolicy, expiresAt: '2026-01-01T00:00:00.000Z' }),
      'Wallet policy expiry must be in the future',
      'Строк дії політики гаманця має закінчуватися в майбутньому.'],
    ['a wallet policy for a wallet that was removed', () => walletService().setPolicy({ ...walletPolicy, expiresAt: '2099-01-01T00:00:00.000Z' }),
      'Wallet not found',
      'Гаманець не знайдено.'],
    ['cancelling a new wallet before saving its recovery phrase', () => generateWalletWithRecoveryConfirmation(onboarding() as never, {} as never, async () => false),
      'Wallet creation cancelled before recovery confirmation',
      'Створення гаманця скасовано до підтвердження фрази відновлення.'],
    ['a recovery confirmation that could not be saved', () => generateWalletWithRecoveryConfirmation(onboarding() as never, {} as never, async () => true),
      'Wallet recovery confirmation failed',
      'Не вдалося підтвердити фразу відновлення гаманця.'],
    ['a new wallet that could not be removed after its confirmation failed', () => generateWalletWithRecoveryConfirmation(onboarding(async () => false) as never, {} as never, async () => true),
      'Wallet recovery confirmation failed and the unconfirmed wallet could not be removed',
      'Не вдалося підтвердити фразу відновлення, а непідтверджений гаманець не вдалося видалити.'],
    // Wallet approval prompt
    ['approving after signing keys were locked', () => approveWalletRequest(approvals(undefined, [0, 1]) as never, 'request-1'),
      'Wallet request was cancelled because signing keys were locked',
      'Запит гаманця скасовано, бо ключі підписання заблоковано.'],
    ['approving a request that already settled', () => approveWalletRequest(approvals(undefined) as never, 'request-1'),
      'Wallet request not found',
      'Запит гаманця не знайдено.'],
    ['approving a request twice', () => approveWalletRequest(approvals({ id: 'request-1', status: 'approved' }) as never, 'request-1'),
      'Wallet request is not awaiting human approval',
      'Запит гаманця не очікує схвалення людини.']
  ] as const)('%s keeps its English message and reaches the shell in the interface language', async (_name, action, inEnglish, inUkrainian) => {
    const error = await failure(action)
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe(inEnglish)
    await expect(shownTo(SHELL_URL, error)).resolves.toBe(inUkrainian)
    await expect(shownTo('https://site.example/', error)).resolves.toBe(inEnglish)
  })

  it('keeps the secure storage text for logs and tells a person only that the saved password could not be decrypted', async () => {
    const keyring = new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString. Keyring is locked.')
    const { store, id } = await savedCredential(async () => { throw keyring })
    const error = await failure(() => store.password(id))
    expect(error).toBeInstanceOf(LocalizedError)
    expect(error).toMatchObject({ message: keyring.message, cause: keyring })
    const shown = await shownTo(SHELL_URL, error)
    expect(shown).toBe('Не вдалося розшифрувати збережений пароль. Переконайтеся, що захищене сховище системи розблоковано, і спробуйте ще раз.')
    for (const detail of ['safeStorage', 'Keyring', 'ciphertext', 'person', 'placeholder', 'accounts.example']) expect(shown).not.toContain(detail)
  })

  it('gives the waiting page and agent the same sanitized English when a request expired before a person approved it', async () => {
    const rejected: unknown[] = []
    const record = { id: 'request-1', status: 'awaiting-human', request: { walletId: 'wallet-1', requester: { type: 'page' }, topLevelOrigin: 'https://dapp.example' } }
    const access = {
      ...approvals(record),
      service: {
        approvals: { get: () => record, approve: async () => { record.status = 'expired'; throw new Error('Wallet request expired') } },
        audit: { append: async () => undefined }
      },
      rejectPending: (_id: string, error: unknown) => { rejected.push(error) },
      publish: () => undefined,
      now: () => new Date('2026-10-19T12:00:00.000Z')
    }
    const error = await failure(() => approveWalletRequest(access as never, 'request-1'))
    expect(error).toBeInstanceOf(LocalizedError)
    expect((error as Error).message).toBe('Wallet request expired before approval')
    await expect(shownTo(SHELL_URL, error)).resolves.toBe('Строк дії запиту гаманця минув до схвалення.')
    expect(rejected).toEqual([error])
    expect(sanitizedError(rejected[0]).message).toBe('Wallet request expired before approval')
  })
})

describe('wallet messages a person now reads in the interface language', () => {
  // Every converted wallet message with the English it had before: the broker passes it on to pages and agents only
  // when it starts with known words, and startup recognizes a secure storage failure by its exact text.
  it.each([
    ['wallet.serviceUnavailable', 'Wallet service is unavailable'],
    ['wallet.windowUnavailable', 'The Hronaut window is unavailable'],
    ['wallet.vaultUnavailable', 'Wallet vault is unavailable'],
    ['wallet.vaultLocked', 'Managed wallet vault is unavailable or locked'],
    ['wallet.passphraseSetupUnavailable', 'Wallet passphrase setup is unavailable'],
    ['wallet.vaultNotLocked', 'Wallet vault is not locked'],
    ['wallet.passphraseRequired', 'Wallet vault passphrase is required'],
    ['wallet.passphraseLength', 'Wallet vault passphrase must be between 12 and 1024 characters'],
    ['wallet.unlockFailed', 'Wallet vault unlock failed'],
    ['wallet.recoveryMaterialInvalid', 'Invalid wallet recovery material'],
    ['wallet.recoveryMaterialMismatch', 'Wallet recovery material is invalid for the selected chain and format'],
    ['wallet.importExpired', 'Wallet import confirmation expired'],
    ['wallet.watchOnlyAddressInvalid', 'Invalid watch-only wallet address'],
    ['wallet.notFound', 'Wallet not found'],
    ['wallet.detachedRequestActive', 'Wallet has a signing or submitted request in a detached workspace'],
    ['wallet.requestActive', 'Wallet has a signing or submitted request in progress'],
    ['wallet.vaultLimit', 'Wallet vault limit reached (10000)'],
    ['wallet.watchOnlyLimit', 'Watch-only wallet limit reached (10000)'],
    ['wallet.recoveryCancelled', WALLET_RECOVERY_CANCELLED_MESSAGE],
    ['wallet.recoveryFailed', 'Wallet recovery confirmation failed'],
    ['wallet.recoveryRollbackFailed', 'Wallet recovery confirmation failed and the unconfirmed wallet could not be removed'],
    ['wallet.requestNotFound', 'Wallet request not found'],
    ['wallet.requestNotAwaiting', 'Wallet request is not awaiting human approval'],
    ['wallet.requestExpired', 'Wallet request expired before approval'],
    ['wallet.requestCancelledLocked', 'Wallet request was cancelled because signing keys were locked'],
    ['walletPolicy.expiryPast', 'Wallet policy expiry must be in the future'],
    ['walletPolicy.signingUnsupported', 'Wallet does not support signing automation'],
    ['walletPolicy.workspaceDetached', 'Wallet policy workspace is not attached to the wallet'],
    ['walletPolicy.networkMissing', 'Wallet policy must include the wallet network'],
    ['walletPolicy.signInNeedsBounded', 'Website sign-in without approval requires a bounded automatic policy'],
    ['walletPolicy.mainnetSignInNeedsSignIn', 'The mainnet website sign-in switch requires website sign-in without approval'],
    ['walletPolicy.signInEvmOnly', 'Website sign-in without approval is only available for EVM wallets'],
    ['walletPolicy.signInNeedsOrigin', 'Website sign-in without approval requires an allowed website origin'],
    ['walletPolicy.mainnetTypedDataNeedsTypedData', 'The mainnet typed-data switch requires typed-data signing without approval'],
    ['walletPolicy.typedDataNeedsSignIn', 'Typed-data signing without approval requires website sign-in without approval'],
    ['walletPolicy.typedDataNeedsAgent', 'Typed-data signing without approval requires a dedicated agent wallet'],
    ['walletPolicy.mainnetTypedDataNeedsSwitch', 'Mainnet typed-data signing without approval requires its separate mainnet switch'],
    ['walletPolicy.mainnetTypedDataMainnetOnly', 'The mainnet typed-data switch is only valid for a mainnet wallet'],
    ['walletPolicy.anyTokenWithContract', 'A wallet policy that allows any token contract cannot also name one'],
    ['walletPolicy.tokenMethodNeedsContract', 'A wallet policy for a token method must name its token contract or allow any token contract'],
    ['walletPolicy.mainnetBypassNeedsAgent', 'Mainnet Bypass Approve mode requires a dedicated EVM agent wallet'],
    ['walletPolicy.mainnetBypassOneContract', 'Mainnet Bypass Approve mode allows one token contract'],
    ['walletPolicy.mainnetBypassLimits', 'Mainnet Bypass Approve mode requires complete transaction, spend, fee, operation, and expiry limits'],
    ['walletPolicy.mainnetSignInLimits', 'Mainnet website sign-in without approval requires its separate mainnet switch, one website origin, at most 100 operations and an expiry within 7 days'],
    ['walletPolicy.mainnetSignInNoTransactions', 'A mainnet sign-in policy without Bypass Approve cannot list transaction destinations, contracts or methods'],
    ['walletPolicy.bypassMainnetOnly', 'Bypass Approve mode is only valid for a mainnet agent policy'],
    ['walletPolicy.mainnetSignInMainnetOnly', 'The mainnet website sign-in switch is only valid for a mainnet wallet'],
    ['walletPolicy.networkIneligible', 'Wallet network is not eligible for automatic approval'],
    ['walletPolicy.identityMoved', 'Wallet policy identity cannot be moved between wallets'],
    ['walletPolicy.removedDuringRemoval', 'Wallet policy disappeared during removal'],
    ['walletPolicy.saveRollbackFailed', 'Wallet policy descriptor update failed and its rollback was incomplete'],
    ['walletPolicy.removeRollbackFailed', 'Wallet policy removal failed and its rollback was incomplete']
  ] as const)('%s keeps the English that pages, agents and startup read', (key, english) => {
    const error = new LocalizedError(`appErrors.${key}`, { max: 10_000 })
    expect(error.message).toBe(english)
    expect(error.name).toBe('Error')
    const passedOn = sanitizedError(error)
    expect(passedOn).not.toBeInstanceOf(LocalizedError)
    expect(passedOn.message).toBe(sanitizedError(new Error(english)).message)
    expect(walletStartupFailureStatus(error)).toEqual(walletStartupFailureStatus(new Error(english)))
    expect(ukrainian(`appErrors.${key}`, { max: 10_000 })).not.toBe(english)
  })

  it('still disables managed wallets as a secure storage failure when the vault cannot be unlocked at startup', async () => {
    const error = await failure(() => new SafeStorageWalletKeyWrapper({
      decryptStringAsync: async () => { throw new Error('The keyring is locked') }
    } as never).unwrap({ mode: 'safe-storage', wrappedKey: 'AAAA' }))
    expect(walletStartupFailureStatus(error)).toMatchObject({ managedWallets: 'disabled', backend: 'secure-storage-failure' })
    expect(sanitizedError(error).message).toBe('Wallet vault unlock failed')
  })
})
