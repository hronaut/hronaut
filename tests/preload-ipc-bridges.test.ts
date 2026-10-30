import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { EventChannel, InvokeChannel, SendChannel } from '../src/shared/ipc/channel.js'
import { DEFAULT_BROWSER_ENVIRONMENT } from '../src/shared/browser-environment.js'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), invoke: vi.fn(), on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: electron.exposeInMainWorld }, ipcRenderer: electron }))
afterEach(() => { vi.resetModules(); vi.clearAllMocks() })

// The main window's shell, which alone gets the tab rail over the page.
const argv = process.argv
beforeAll(() => { process.argv = [...argv, '--hronaut-window-kind=main'] })
afterAll(() => { process.argv = argv })

type Method = (...args: unknown[]) => unknown

// The overlay views' own preloads; every other API comes from the shell's.
const viewPreloads: Record<string, () => Promise<unknown>> = {
  hronautAddressOverlayView: () => import('../src/preload/address-overlay.js'),
  hronautAgentCardView: () => import('../src/preload/agent-card.js'),
  hronautToastOverlayView: () => import('../src/preload/toast-overlay.js'),
  hronautSidebarOverlayView: () => import('../src/preload/sidebar-overlay.js'),
  hronautTooltipOverlayView: () => import('../src/preload/tooltip-overlay.js'),
  hronautStatusBubbleView: () => import('../src/preload/status-bubble.js')
}

// A method of an exposed API by its path, as `collections.list` on window.hronautBookmarks.
async function exposed(name: string, path: string): Promise<Method> {
  await (viewPreloads[name] ?? (() => import('../src/preload/index.js')))()
  const api: unknown = electron.exposeInMainWorld.mock.calls.find(([exposedName]) => exposedName === name)?.[1]
  const method = path.split('.').reduce<unknown>((owner, key) => (owner as Record<string, unknown> | undefined)?.[key], api)
  if (typeof method !== 'function') throw new Error(`${name}.${path} is not exposed`)
  return method as Method
}

// Values as main sends and takes them: a state with no tabs open, an Undo offer's token, a workspace template, emulation and incident ids.
const browserState = { tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: 'http://127.0.0.1:47321/mcp', profilePath: '/home/person/.config/Hronaut', mcpTabGroups: [], savedTabGroups: [] }
const undoToken = 'c0ffee00-0000-4000-8000-000000000001'
const phoneViewport = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true, touch: true, orientation: 'portrait' }
const darkEnvironment = { ...DEFAULT_BROWSER_ENVIRONMENT, colorScheme: 'dark' }
const draftId = 'c0ffee00-0000-4000-8000-000000000004'
const previewId = 'c0ffee00-0000-4000-8000-000000000005'
const workspaceTemplate = JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'linux', workspaces: [{ name: 'Research', color: 'blue', startPages: ['https://example.com/'] }] })

// Each call the shell makes, with the channel and arguments main receives; the names are the wire's and stay as they were.
const invokes: Array<[api: string, method: string, args: unknown[], channel: string, sent: unknown[]]> = [
  ['hronaut', 'setTabViewport', ['tab-1', phoneViewport], 'browser:set-tab-viewport', ['tab-1', phoneViewport]],
  ['hronaut', 'setTabViewport', ['tab-1', null], 'browser:set-tab-viewport', ['tab-1', null]],
  ['hronaut', 'setTabEnvironment', ['tab-1', darkEnvironment], 'browser:set-tab-environment', ['tab-1', darkEnvironment]],
  ['hronaut', 'resetTabEmulation', ['tab-1'], 'browser:reset-tab-emulation', ['tab-1']],
  ['hronaut', 'recoverTabEmulation', ['tab-1'], 'browser:recover-tab-emulation', ['tab-1']],
  ['hronaut', 'listNetworkRoutes', ['tab-1'], 'browser:list-network-routes', ['tab-1']],
  ['hronaut', 'addNetworkRoute', ['tab-1', { urlPattern: 'https://example.com/api/*', method: 'GET', response: { status: 503 } }], 'browser:add-network-route', ['tab-1', { urlPattern: 'https://example.com/api/*', method: 'GET', response: { status: 503 } }]],
  ['hronaut', 'setNetworkRouteEnabled', ['tab-1', 'route-1', false], 'browser:set-network-route-enabled', ['tab-1', 'route-1', false]],
  ['hronaut', 'moveNetworkRoute', ['tab-1', 'route-1', 'up'], 'browser:move-network-route', ['tab-1', 'route-1', 'up']],
  ['hronaut', 'removeNetworkRoute', ['tab-1', 'route-1'], 'browser:remove-network-route', ['tab-1', 'route-1']],
  ['hronaut', 'clearNetworkRoutes', ['tab-1'], 'browser:clear-network-routes', ['tab-1']],
  ['hronaut', 'clearCssStatePreview', ['tab-1'], 'browser:clear-css-state-preview', ['tab-1']],
  ['hronaut', 'stopLogpoints', ['tab-1'], 'browser:stop-logpoints', ['tab-1']],
  ['hronaut', 'stopVirtualPasskey', ['tab-1'], 'browser:stop-virtual-passkey', ['tab-1']],
  ['hronaut', 'captureIncident', [{ tabId: 'tab-1', minutes: 5, kinds: ['network', 'diagnostics'] }], 'browser:incident-capture', [{ tabId: 'tab-1', minutes: 5, kinds: ['network', 'diagnostics'] }]],
  ['hronaut', 'reviewIncident', [{ draftId, include: ['network'], replacements: [] }], 'browser:incident-review', [{ draftId, include: ['network'], replacements: [] }]],
  ['hronaut', 'invalidateIncidentPreview', [draftId], 'browser:incident-invalidate-preview', [draftId]],
  ['hronaut', 'discardIncident', [], 'browser:incident-discard', []],
  ['hronaut', 'saveIncident', [{ draftId, previewId, reviewed: true }], 'browser:incident-save', [{ draftId, previewId, reviewed: true }]],
  ['hronaut', 'createWorkspace', [{ name: 'Research', color: 'blue', storage: 'scratch' }], 'browser:create-workspace', [{ name: 'Research', color: 'blue', storage: 'scratch' }]],
  ['hronaut', 'openWorkspaceTemplateFile', [], 'browser:open-workspace-template-file', []],
  ['hronaut', 'saveWorkspaceTemplateFile', [workspaceTemplate], 'browser:save-workspace-template-file', [workspaceTemplate]],
  ['hronaut', 'importWorkspaceTemplate', [workspaceTemplate], 'browser:import-workspace-template', [workspaceTemplate]],
  ['hronaut', 'renameTabGroup', ['workspace-1', 'Research'], 'browser:rename-tab-group', ['workspace-1', 'Research']],
  ['hronaut', 'updateTabGroup', ['workspace-1', { color: 'green', agentAccess: false }], 'browser:update-tab-group', ['workspace-1', { color: 'green', agentAccess: false }]],
  ['hronaut', 'reviewWorkspaceContinuity', ['workspace-1'], 'browser:review-workspace-continuity', ['workspace-1']],
  ['hronaut', 'listHumanWaiting', ['workspace-1'], 'browser:list-human-waiting', ['workspace-1']],
  ['hronaut', 'changeHumanWaiting', ['workspace-1', 'decision-1', 'revision-1', 'resolve', { accountAndTargetVerified: true }, 'Paid'], 'browser:change-human-waiting', ['workspace-1', 'decision-1', 'revision-1', 'resolve', { accountAndTargetVerified: true }, 'Paid']],
  ['hronaut', 'changeHumanWaiting', ['workspace-1', 'decision-1', 'revision-1', 'acknowledge'], 'browser:change-human-waiting', ['workspace-1', 'decision-1', 'revision-1', 'acknowledge', undefined, undefined]],
  ['hronaut', 'checkpointWorkspaceContinuity', ['workspace-1', '#order-confirmation'], 'browser:checkpoint-workspace-continuity', ['workspace-1', '#order-confirmation']],
  ['hronaut', 'checkpointWorkspaceContinuity', ['workspace-1'], 'browser:checkpoint-workspace-continuity', ['workspace-1', undefined]],
  ['hronaut', 'reconcileWorkspaceContinuity', ['workspace-1', 'review-1', true], 'browser:reconcile-workspace-continuity', ['workspace-1', 'review-1', true]],
  ['hronaut', 'updateWorkspaceNavigationPolicy', ['workspace-1', { mode: 'restricted', rules: ['https://example.com'] }], 'browser:update-workspace-navigation-policy', ['workspace-1', { mode: 'restricted', rules: ['https://example.com'] }]],
  ['hronaut', 'listWorkspaceNavigationAudit', ['workspace-1'], 'browser:list-workspace-navigation-audit', ['workspace-1']],
  ['hronaut', 'listWorkspaceStorageOrigins', ['workspace-1'], 'browser:list-workspace-storage-origins', ['workspace-1']],
  ['hronaut', 'transferWorkspaceStorage', [{ sourceWorkspaceId: 'workspace-1', targetWorkspaceId: 'workspace-2', mode: 'copy', origins: ['https://example.com'] }], 'browser:transfer-workspace-storage', [{ sourceWorkspaceId: 'workspace-1', targetWorkspaceId: 'workspace-2', mode: 'copy', origins: ['https://example.com'] }]],
  ['hronaut', 'closeWorkspace', ['workspace-1', { undoable: true }], 'browser:close-workspace', ['workspace-1', { undoable: true }]],
  ['hronaut', 'closeWorkspace', ['workspace-1'], 'browser:close-workspace', ['workspace-1', undefined]],
  ['hronaut', 'saveAndCloseTabGroup', ['workspace-1'], 'browser:save-and-close-tab-group', ['workspace-1']],
  ['hronaut', 'restoreSavedTabGroup', ['saved-1'], 'browser:restore-saved-tab-group', ['saved-1']],
  ['hronaut', 'deleteSavedTabGroup', ['saved-1'], 'browser:delete-saved-tab-group', ['saved-1']],
  ['hronaut', 'showWorkspaceContextMenu', ['workspace-1'], 'browser:show-workspace-context-menu', ['workspace-1']],
  ['hronaut', 'browserImport.list', ['workspace-1'], 'browser-import:list', ['workspace-1']],
  ['hronaut', 'browserImport.preview', ['workspace-1', 'c0ffee00-0000-4000-8000-000000000002'], 'browser-import:preview', ['workspace-1', 'c0ffee00-0000-4000-8000-000000000002']],
  ['hronaut', 'browserImport.commit', ['c0ffee00-0000-4000-8000-000000000003', ['example.com']], 'browser-import:commit', ['c0ffee00-0000-4000-8000-000000000003', ['example.com']]],
  ['hronaut', 'browserImport.cancel', [], 'browser-import:cancel', []],
  ['hronaut', 'getState', [], 'browser:get-state', []],
  ['hronaut', 'getTabOverviewPreviews', [['tab-1', 'tab-2']], 'browser:get-tab-overview-previews', [['tab-1', 'tab-2']]],
  ['hronaut', 'getTabOverviewPagePreview', ['tab-1'], 'browser:get-tab-overview-page-preview', ['tab-1']],
  ['hronaut', 'openHome', [], 'browser:open-home', []],
  ['hronaut', 'newTab', [{ url: 'https://example.com/', active: true }], 'browser:new-tab', [{ url: 'https://example.com/', active: true }]],
  ['hronaut', 'newTab', [], 'browser:new-tab', [{}]],
  ['hronaut', 'reopenClosedTab', ['closed-1'], 'browser:reopen-closed-tab', ['closed-1']],
  ['hronaut', 'reopenClosedTab', [], 'browser:reopen-closed-tab', [undefined]],
  ['hronaut', 'selectTab', ['tab-1'], 'browser:select-tab', ['tab-1']],
  ['hronaut', 'closeTab', ['tab-1'], 'browser:close-tab', ['tab-1']],
  ['hronaut', 'closeTabs', [['tab-1', 'tab-2']], 'browser:close-tabs', [['tab-1', 'tab-2']]],
  ['hronaut', 'openSplitView', ['tab-2'], 'browser:open-split-view', ['tab-2']],
  ['hronaut', 'updateSplitView', [{ orientation: 'horizontal', ratio: 0.4 }], 'browser:update-split-view', [{ orientation: 'horizontal', ratio: 0.4 }]],
  ['hronaut', 'closeSplitView', [], 'browser:close-split-view', []],
  ['hronaut', 'setTabLabel', ['tab-1', 'Docs'], 'browser:set-tab-label', ['tab-1', 'Docs']],
  ['hronaut', 'setTabPinned', ['tab-1', true], 'browser:set-tab-pinned', ['tab-1', true]],
  ['hronaut', 'setTabSleeping', ['tab-1', true], 'browser:set-tab-sleeping', ['tab-1', true]],
  ['hronaut', 'setTabAgentPaused', ['tab-1', true, { takeOver: true }], 'browser:set-tab-agent-paused', ['tab-1', true, { takeOver: true }]],
  ['hronaut', 'setTabAgentPaused', ['tab-1', false], 'browser:set-tab-agent-paused', ['tab-1', false, undefined]],
  ['hronaut', 'setTabPageLifecycle', ['tab-1', 'frozen'], 'browser:set-tab-page-lifecycle', ['tab-1', 'frozen']],
  ['hronaut', 'sleepInactiveTabs', [], 'browser:sleep-inactive-tabs', []],
  ['hronaut', 'reorderTab', ['tab-1', 'tab-2', 'after'], 'browser:reorder-tab', ['tab-1', 'tab-2', 'after']],
  ['hronaut', 'reorderTabs', [['tab-1', 'tab-3'], 'tab-2', 'before'], 'browser:reorder-tabs', [['tab-1', 'tab-3'], 'tab-2', 'before']],
  ['hronaut', 'dropLink', ['https://example.com/', { tabId: 'tab-1', placement: 'after' }], 'browser:drop-link', ['https://example.com/', { tabId: 'tab-1', placement: 'after' }]],
  ['hronaut', 'focusActivePage', [], 'browser:focus-active-page', []],
  ['hronaut', 'showTabContextMenu', ['tab-1', ['tab-1', 'tab-2']], 'browser:show-tab-context-menu', ['tab-1', ['tab-1', 'tab-2']]],
  ['hronaut', 'showTabContextMenu', ['tab-1'], 'browser:show-tab-context-menu', ['tab-1', undefined]],
  ['hronaut', 'setTabMuted', ['tab-1', true], 'browser:set-tab-muted', ['tab-1', true]],
  ['hronaut', 'setAllTabsMuted', [false], 'browser:set-all-tabs-muted', [false]],
  ['hronaut', 'setTabHumanInteractionLocked', ['tab-1', true], 'browser:set-tab-human-interaction-locked', ['tab-1', true]],
  ['hronaut', 'setAllHumanInteractionLocked', [false], 'browser:set-all-human-interaction-locked', [false]],
  ['hronaut', 'navigate', [{ tabId: 'tab-1', url: 'https://example.com/' }], 'browser:navigate', [{ tabId: 'tab-1', url: 'https://example.com/' }]],
  ['hronaut', 'back', ['tab-1'], 'browser:back', ['tab-1']],
  ['hronaut', 'back', [], 'browser:back', [undefined]],
  ['hronaut', 'forward', ['tab-1'], 'browser:forward', ['tab-1']],
  ['hronaut', 'forward', [], 'browser:forward', [undefined]],
  ['hronaut', 'showHistoryMenu', [{ tabId: 'tab-1', direction: 'back', anchor: { x: 12, y: 40 } }], 'browser:show-history-menu', [{ tabId: 'tab-1', direction: 'back', anchor: { x: 12, y: 40 } }]],
  ['hronaut', 'openNavigationInNewTab', [{ tabId: 'tab-1', target: 'reload', active: false }], 'browser:open-navigation-in-new-tab', [{ tabId: 'tab-1', target: 'reload', active: false }]],
  ['hronaut', 'reload', ['tab-1'], 'browser:reload', ['tab-1']],
  ['hronaut', 'reload', [], 'browser:reload', [undefined]],
  ['hronaut', 'proceedPastCertificateError', ['tab-1'], 'browser:proceed-past-certificate', ['tab-1']],
  ['hronaut', 'reloadIgnoringCache', ['tab-1'], 'browser:reload-ignoring-cache', ['tab-1']],
  ['hronaut', 'reloadIgnoringCache', [], 'browser:reload-ignoring-cache', [undefined]],
  ['hronaut', 'stop', ['tab-1'], 'browser:stop', ['tab-1']],
  ['hronaut', 'stop', [], 'browser:stop', [undefined]],
  ['hronaut', 'findInPage', [{ tabId: 'tab-1', query: 'docs', forward: true, findNext: true }], 'browser:find-in-page', [{ tabId: 'tab-1', query: 'docs', forward: true, findNext: true }]],
  ['hronaut', 'stopFindInPage', ['tab-1', { activateMatch: true }], 'browser:stop-find-in-page', ['tab-1', { activateMatch: true }]],
  ['hronaut', 'stopFindInPage', [], 'browser:stop-find-in-page', [undefined, undefined]],
  ['hronaut', 'setZoom', [{ tabId: 'tab-1', action: 'set', percent: 125 }], 'browser:set-zoom', [{ tabId: 'tab-1', action: 'set', percent: 125 }]],
  ['hronaut', 'savePdf', [{ tabId: 'tab-1', landscape: true, pageSize: 'A4' }], 'browser:save-pdf', [{ tabId: 'tab-1', landscape: true, pageSize: 'A4' }]],
  ['hronaut', 'savePdf', [], 'browser:save-pdf', [{}]],
  ['hronaut', 'toggleDevTools', ['tab-1'], 'browser:toggle-devtools', ['tab-1']],
  ['hronaut', 'toggleDevTools', [], 'browser:toggle-devtools', [undefined]],
  ['hronaut', 'showDevToolsConsole', ['tab-1'], 'browser:show-devtools-console', ['tab-1']],
  ['hronaut', 'showDevToolsConsole', [], 'browser:show-devtools-console', [undefined]],
  ['hronaut', 'undo', [undoToken], 'undo:run', [undoToken]],
  ['hronaut', 'holdUndo', [undoToken], 'undo:hold', [undoToken]],
  ['hronaut', 'finishUndo', [undoToken], 'undo:finish', [undoToken]],
  ['hronaut', 'getUserAttention', [], 'attention:get', []],
  ['hronaut', 'answerUserAttention', ['attention-1', 'resolved'], 'attention:answer', ['attention-1', 'resolved']],
  ['hronaut', 'copyQrCode', ['https://example.com/'], 'browser:copy-qr-code', ['https://example.com/']],
  ['hronaut', 'downloadQrCode', [{ tabId: 'tab-1', text: 'https://example.com/', address: 'https://example.com/' }], 'browser:download-qr-code', [{ tabId: 'tab-1', text: 'https://example.com/', address: 'https://example.com/' }]],
  ['hronaut', 'show', [], 'browser:show', []],
  ['hronaut', 'quit', [], 'browser:quit', []],
  ['hronaut', 'copyText', ['https://example.com/'], 'browser:copy-text', ['https://example.com/']],
  ['hronautLicense', 'getState', [], 'license:get-state', []],
  ['hronautLicense', 'activate', ['KEY-1'], 'license:activate', ['KEY-1']],
  ['hronautLicense', 'refresh', [], 'license:refresh', []],
  ['hronautLicense', 'deactivate', [], 'license:deactivate', []],
  ['hronautLicense', 'openPurchase', [], 'license:open-purchase', []],
  ['hronautUpdates', 'getState', [], 'updates:get-state', []],
  ['hronautUpdates', 'getReleaseHistory', [2, true], 'updates:get-release-history', [2, true]],
  ['hronautUpdates', 'check', [], 'updates:check', []],
  ['hronautUpdates', 'download', [], 'updates:download', []],
  ['hronautUpdates', 'install', [], 'updates:install', []],
  ['hronautTaskManager', 'list', [], 'task-manager:list', []],
  ['hronautTaskManager', 'endProcess', [42], 'task-manager:end-process', [42]],
  ['hronautPermissions', 'list', [], 'permissions:list', []],
  ['hronautPermissions', 'set', ['https://a.test', 'camera', 'allow', { workspaceId: 'workspace-1' }], 'permissions:set', ['https://a.test', 'camera', 'allow', { workspaceId: 'workspace-1' }]],
  ['hronautPermissions', 'remove', ['https://a.test', 'camera', { workspaceId: 'workspace-1' }], 'permissions:remove', ['https://a.test', 'camera', { workspaceId: 'workspace-1' }]],
  ['hronautPermissions', 'clear', [], 'permissions:clear', []],
  ['hronautBrowsingData', 'summary', [], 'browsing-data:summary', []],
  ['hronautBrowsingData', 'siteSummary', ['https://a.test/', 'tab-1'], 'browsing-data:site-summary', ['https://a.test/', 'tab-1']],
  ['hronautBrowsingData', 'websites', [], 'browsing-data:websites', []],
  ['hronautBrowsingData', 'clear', [{ history: true, origin: 'https://a.test' }], 'browsing-data:clear', [{ history: true, origin: 'https://a.test' }]],
  ['hronautCredentials', 'status', [], 'credentials:status', []],
  ['hronautCredentials', 'list', [], 'credentials:list', []],
  ['hronautCredentials', 'importFromCsv', [], 'credentials:import-csv', []],
  ['hronautCredentials', 'fill', ['tab-1', 'credential-1'], 'credentials:fill', ['tab-1', 'credential-1']],
  ['hronautCredentials', 'remove', ['credential-1'], 'credentials:remove', ['credential-1']],
  ['hronautCredentials', 'clear', [], 'credentials:clear', []],
  ['hronautDownloads', 'list', [], 'downloads:list', [false]],
  ['hronautDownloads', 'list', [true], 'downloads:list', [true]],
  ['hronautDownloads', 'pause', ['download-1'], 'downloads:pause', ['download-1']],
  ['hronautDownloads', 'resume', ['download-1'], 'downloads:resume', ['download-1']],
  ['hronautDownloads', 'cancel', ['download-1'], 'downloads:cancel', ['download-1']],
  ['hronautDownloads', 'retry', ['download-1'], 'downloads:retry', ['download-1']],
  ['hronautDownloads', 'removeFinished', ['download-1'], 'downloads:remove-finished', ['download-1']],
  ['hronautDownloads', 'clearFinished', [], 'downloads:clear-finished', []],
  ['hronautDownloads', 'showInFolder', ['download-1'], 'downloads:show-in-folder', ['download-1']],
  ['hronautDownloads', 'startDrag', ['download-1'], 'downloads:start-drag', ['download-1']],
  ['hronautBookmarks', 'list', [], 'bookmarks:list', []],
  ['hronautBookmarks', 'add', ['https://a.test/', 'A'], 'bookmarks:add', ['https://a.test/', 'A']],
  ['hronautBookmarks', 'addIfMissing', ['https://a.test/', 'A'], 'bookmarks:add-if-missing', ['https://a.test/', 'A']],
  ['hronautBookmarks', 'rename', ['bookmark-1', 'B'], 'bookmarks:rename', ['bookmark-1', 'B']],
  ['hronautBookmarks', 'updateDestination', ['bookmark-1', 'https://b.test/'], 'bookmarks:update-destination', ['bookmark-1', 'https://b.test/']],
  ['hronautBookmarks', 'remove', ['bookmark-1'], 'bookmarks:remove', ['bookmark-1']],
  ['hronautBookmarks', 'exportFile', [], 'bookmarks:export-file', []],
  ['hronautBookmarks', 'importFile', [], 'bookmarks:import-file', []],
  ['hronautBookmarks', 'collections.list', [], 'bookmark-collections:list', []],
  ['hronautBookmarks', 'collections.create', ['Reading'], 'bookmark-collections:create', ['Reading']],
  ['hronautBookmarks', 'collections.rename', ['collection-1', 'Later'], 'bookmark-collections:rename', ['collection-1', 'Later']],
  ['hronautBookmarks', 'collections.remove', ['collection-1'], 'bookmark-collections:remove', ['collection-1']],
  ['hronautBookmarks', 'collections.assign', ['bookmark-1', null], 'bookmark-collections:assign', ['bookmark-1', null]],
  ['hronautBookmarks', 'collections.bookmarkTabs', [null, 'Tabs'], 'bookmark-collections:bookmark-tabs', [null, 'Tabs']],
  ['hronautHistory', 'list', [], 'visit-history:list', []],
  ['hronautHistory', 'remove', ['entry-1'], 'visit-history:remove', ['entry-1']],
  ['hronautHistory', 'clear', [], 'visit-history:clear', []],
  ['hronautMcp', 'getState', [], 'mcp:get-state', []],
  ['hronautMcp', 'setPaused', [true], 'mcp:set-paused', [true]],
  ['hronautMcp', 'moveToSuggestedPort', [9334], 'mcp:move-to-suggested-port', [9334]],
  ['hronautWallets', 'status', [], 'wallets:status', []],
  ['hronautWallets', 'list', [], 'wallets:list', []],
  ['hronautWallets', 'setupPassphrase', ['correct horse'], 'wallets:setup-passphrase', ['correct horse']],
  ['hronautWallets', 'unlock', ['correct horse'], 'wallets:unlock', ['correct horse']],
  ['hronautWallets', 'lock', [], 'wallets:lock', []],
  ['hronautWallets', 'generate', [{ chainFamily: 'evm', name: 'Test' }], 'wallets:generate', [{ chainFamily: 'evm', name: 'Test' }]],
  ['hronautWallets', 'prepareImport', ['evm', 'mnemonic', 'words'], 'wallets:prepare-import', ['evm', 'mnemonic', 'words']],
  ['hronautWallets', 'confirmImport', ['token-1', { name: 'Imported' }], 'wallets:confirm-import', ['token-1', { name: 'Imported' }]],
  ['hronautWallets', 'cancelImport', ['token-1'], 'wallets:cancel-import', ['token-1']],
  ['hronautWallets', 'addWatchOnly', [{ chainFamily: 'evm', publicAddress: '0x1' }], 'wallets:add-watch-only', [{ chainFamily: 'evm', publicAddress: '0x1' }]],
  ['hronautWallets', 'update', ['wallet-1', { name: 'Renamed' }], 'wallets:update', ['wallet-1', { name: 'Renamed' }]],
  ['hronautWallets', 'remove', ['wallet-1'], 'wallets:remove', ['wallet-1']],
  ['hronautWallets', 'listPolicies', [], 'wallets:list-policies', [undefined]],
  ['hronautWallets', 'listPolicies', ['wallet-1'], 'wallets:list-policies', ['wallet-1']],
  ['hronautWallets', 'setPolicy', [{ id: 'policy-1' }], 'wallets:set-policy', [{ id: 'policy-1' }]],
  ['hronautWallets', 'removePolicy', ['policy-1'], 'wallets:remove-policy', ['policy-1']],
  ['hronautWallets', 'listPermissions', [], 'wallets:list-permissions', []],
  ['hronautWallets', 'revokePermission', ['permission-1'], 'wallets:revoke-permission', ['permission-1']],
  ['hronautWallets', 'listRequests', [], 'wallets:list-requests', []],
  ['hronautWallets', 'approveRequest', ['request-1'], 'wallets:approve-request', ['request-1']],
  ['hronautWallets', 'rejectRequest', ['request-1'], 'wallets:reject-request', ['request-1']],
  ['hronautWallets', 'auditHistory', [], 'wallets:audit-history', []],
  ['hronautSettings', 'get', [], 'settings:get', []],
  ['hronautSettings', 'getRendererState', [], 'settings:get-renderer-state', []],
  ['hronautSettings', 'getSystemTheme', [], 'settings:get-system-theme', []],
  ['hronautSettings', 'resetAppearance', [], 'settings:reset-appearance', []],
  ['hronautSettings', 'resetGeneral', [], 'settings:reset-general', []],
  ['hronautSettings', 'setTheme', ['dark'], 'settings:set-theme', ['dark']],
  ['hronautSettings', 'setInterfaceScale', [1.1], 'settings:set-interface-scale', [1.1]],
  ['hronautSettings', 'setTabPosition', ['left'], 'settings:set-tab-position', ['left']],
  ['hronautSettings', 'setUseSystemTitleBar', [true], 'settings:set-use-system-title-bar', [true]],
  ['hronautSettings', 'setSearchEngine', ['duckduckgo'], 'settings:set-search-engine', ['duckduckgo']],
  ['hronautSettings', 'addSiteSearch', [{ name: 'Docs', keyword: 'docs', url: 'https://docs.test/?q=%s' }], 'settings:add-site-search', [{ name: 'Docs', keyword: 'docs', url: 'https://docs.test/?q=%s' }]],
  ['hronautSettings', 'updateSiteSearch', ['id-1', { name: 'Docs', keyword: 'docs', url: 'https://docs.test/?q=%s' }], 'settings:update-site-search', ['id-1', { name: 'Docs', keyword: 'docs', url: 'https://docs.test/?q=%s' }]],
  ['hronautSettings', 'removeSiteSearch', ['id-1'], 'settings:remove-site-search', ['id-1']],
  ['hronautSettings', 'setSecureDns', ['secure', 'https://dns.test/dns-query'], 'settings:set-secure-dns', ['secure', 'https://dns.test/dns-query']],
  ['hronautSettings', 'setHideInTray', [true], 'settings:set-hide-in-tray', [true]],
  ['hronautSettings', 'setLaunchAtStartup', [true], 'settings:set-launch-at-startup', [true]],
  ['hronautSettings', 'setLaunchMinimized', [true], 'settings:set-launch-minimized', [true]],
  ['hronautSettings', 'setAttentionSound', [true], 'settings:set-attention-sound', [true]],
  ['hronautSettings', 'setAttentionSoundCue', ['warning'], 'settings:set-attention-sound-cue', ['warning']],
  ['hronautSettings', 'setFollowAgentActivity', [true], 'settings:set-follow-agent-activity', [true]],
  ['hronautSettings', 'setShowAgentCursor', [true], 'settings:set-show-agent-cursor', [true]],
  ['hronautSettings', 'setPinAgentLiveStatus', [true], 'settings:set-pin-agent-live-status', [true]],
  ['hronautSettings', 'setSpellCheck', [true], 'settings:set-spell-check', [true]],
  ['hronautSettings', 'getSpellCheckLanguages', [], 'settings:spell-check-languages', []],
  ['hronautSettings', 'setSpellCheckLanguages', [['en-US']], 'settings:set-spell-check-languages', [['en-US']]],
  ['hronautSettings', 'setChallengeDetectionEnabled', [true], 'settings:set-challenge-detection', [true]],
  ['hronautSettings', 'setOmitAgentUrlDetail', [true], 'settings:set-omit-agent-url-detail', [true]],
  ['hronautSettings', 'setAllowWebsiteFileSaving', [true], 'settings:set-allow-website-file-saving', [true]],
  ['hronautSettings', 'setMcpRemoteAccess', [true], 'settings:set-mcp-remote-access', [true]],
  ['hronautSettings', 'setMcpAuthentication', [true], 'settings:set-mcp-authentication', [true]],
  ['hronautSettings', 'setMcpPort', [9334], 'settings:set-mcp-port', [9334]],
  ['hronautSettings', 'setMcpToolSet', ['qa'], 'settings:set-mcp-tool-set', ['qa']],
  ['hronautSettings', 'resetMcp', [], 'settings:reset-mcp', []],
  ['hronautSettings', 'listMcpCapabilityProfiles', [], 'settings:list-mcp-capability-profiles', []],
  ['hronautSettings', 'createMcpCapabilityProfile', [{ name: 'CI', preset: 'read-only' }], 'settings:create-mcp-capability-profile', [{ name: 'CI', preset: 'read-only' }]],
  ['hronautSettings', 'updateMcpCapabilityProfile', ['id-1', { name: 'CI', preset: 'read-only' }], 'settings:update-mcp-capability-profile', ['id-1', { name: 'CI', preset: 'read-only' }]],
  ['hronautSettings', 'rotateMcpCapabilityProfile', ['id-1'], 'settings:rotate-mcp-capability-profile', ['id-1']],
  ['hronautSettings', 'revokeMcpCapabilityProfile', ['id-1'], 'settings:revoke-mcp-capability-profile', ['id-1']],
  ['hronautSettings', 'getDefaultDownloadDirectory', [], 'settings:get-default-download-directory', []],
  ['hronautSettings', 'chooseDownloadDirectory', [], 'settings:choose-download-directory', []],
  ['hronautSettings', 'setAskWhereToSaveDownloads', [true], 'settings:set-ask-where-to-save-downloads', [true]],
  ['hronautSettings', 'resetDownloads', [], 'settings:reset-downloads', []],
  ['hronautSettings', 'openDownloadDirectory', [], 'settings:open-download-directory', []],
  ['hronautSettings', 'setMemorySaverEnabled', [true], 'settings:set-memory-saver-enabled', [true]],
  ['hronautSettings', 'setMemorySaverTimeoutMinutes', [30], 'settings:set-memory-saver-timeout', [30]],
  ['hronautSettings', 'resetMemorySaver', [], 'settings:reset-memory-saver', []],
  ['hronautSettings', 'setGraphicsAcceleration', [true], 'settings:set-graphics-acceleration', [true]],
  ['hronautSettings', 'graphicsAccelerationInUse', [], 'settings:graphics-acceleration-in-use', []],
  ['hronautSettings', 'restart', [], 'app:restart', []],
  ['hronautSettings', 'setCheckForUpdatesOnStartup', [true], 'settings:set-check-on-startup', [true]],
  ['hronautSettings', 'setLanguagePreference', ['uk-UA'], 'settings:set-language-preference', ['uk-UA']],
  ['hronautShell', 'isWindowFocused', [], 'shell:is-window-focused', []],
  ['hronautPanelWindow', 'open', ['bookmarks'], 'panel-window:open', ['bookmarks']],
  ['hronautPanelWindow', 'close', [], 'panel-window:close', []],
  ['hronautPanelWindow', 'setActive', ['network'], 'panel-window:set-active', ['network']],
  ['hronautPanelWindow', 'redock', ['bookmarks', 'left'], 'panel-window:redock', ['bookmarks', 'left']],
  ['hronautPanelWindow', 'bookmarkAllTabs', ['workspace-1'], 'panel-window:bookmark-all-tabs', ['workspace-1']],
  ['hronautPanelWindow', 'bookmarkAllTabs', [null], 'panel-window:bookmark-all-tabs', [null]],
  ['hronautSplitDivider', 'get', [], 'split-divider:get', []],
  ['hronautSplitDivider', 'begin', [3], 'split-divider:begin', [3]],
  ['hronautSplitDivider', 'update', ['token-1', 0.4], 'split-divider:update', ['token-1', 0.4]],
  ['hronautSplitDivider', 'finish', ['token-1', true, 0.4], 'split-divider:finish', ['token-1', true, 0.4]],
  ['hronautSplitDivider', 'finish', ['token-1', false], 'split-divider:finish', ['token-1', false, undefined]],
  ['hronautSplitDivider', 'setRatio', [3, 0.5], 'split-divider:set-ratio', [3, 0.5]],
  ['hronautEmulationFrame', 'get', [], 'emulation-frame:get', []],
  ['hronautPageCard', 'get', [], 'page-card:get', []],
  ['hronautAgentPresence', 'get', [], 'agent-presence:get', []],
  ['hronautAgentPresence', 'steps', [{ clientKey: 'AbCdEfGhIjKlMnOpQrStUv', workspaceId: 'workspace-1', known: [] }], 'agent-presence:steps', [{ clientKey: 'AbCdEfGhIjKlMnOpQrStUv', workspaceId: 'workspace-1', known: [] }]]
]

it.each(invokes)('%s.%s asks main on its channel with its arguments and returns main\'s answer', async (api, method, args, channel, sent) => {
  electron.invoke.mockResolvedValueOnce('answer')
  const call = await exposed(api, method)
  await expect(call(...args)).resolves.toBe('answer')
  expect(electron.invoke).toHaveBeenCalledExactlyOnceWith(channel, ...sent)
})

// Each message the shell and the overlay views send without waiting for an answer, with what main receives.
const sends: Array<[api: string, method: string, args: unknown[], channel: string, sent: unknown[]]> = [
  ['hronaut', 'stateDrawn', [], 'browser:state-drawn', []],
  ['hronautAddressOverlay', 'show', [{ sessionId: 1 }], 'address-overlay:show', [{ sessionId: 1 }]],
  ['hronautAddressOverlay', 'hide', [], 'address-overlay:hide', []],
  ['hronautAddressOverlay', 'returnFocus', [], 'address-overlay:return-focus', []],
  ['hronautAgentCard', 'show', [{ cardId: 1 }], 'agent-card:show', [{ cardId: 1 }]],
  ['hronautAgentCard', 'hide', [1], 'agent-card:hide', [1]],
  ['hronautToastOverlay', 'show', [{ toast: null }], 'toast-overlay:show', [{ toast: null }]],
  ['hronautSidebarOverlay', 'show', [{ id: 1 }], 'sidebar-overlay:show', [{ id: 1 }]],
  ['hronautSidebarOverlay', 'hide', [1], 'sidebar-overlay:hide', [1]],
  ['hronautShell', 'showTooltip', [{ id: 1, text: 'Back' }], 'shell-tooltip:show', [{ id: 1, text: 'Back' }]],
  ['hronautShell', 'hideTooltip', [1], 'shell-tooltip:hide', [1]],
  ['hronautShell', 'hideTooltip', [], 'shell-tooltip:hide', [undefined]],
  ['hronautAddressOverlayView', 'select', [{ sessionId: 1, suggestionId: 's-1' }], 'address-overlay:select', [{ sessionId: 1, suggestionId: 's-1' }]],
  ['hronautAddressOverlayView', 'measured', [120], 'address-overlay:measured', [120]],
  ['hronautAgentCardView', 'measured', [{ cardId: 1 }], 'agent-card-view:measured', [{ cardId: 1 }]],
  ['hronautAgentCardView', 'send', [{ cardId: 1, kind: 'close', reason: 'escape' }], 'agent-card-view:message', [{ cardId: 1, kind: 'close', reason: 'escape' }]],
  ['hronautToastOverlayView', 'measured', [{ revision: 1 }], 'toast-overlay-view:measured', [{ revision: 1 }]],
  ['hronautToastOverlayView', 'send', [{ id: 1, kind: 'act' }], 'toast-overlay-view:message', [{ id: 1, kind: 'act' }]],
  ['hronautSidebarOverlayView', 'rendered', [{ revision: 1 }], 'sidebar-overlay-view:rendered', [{ revision: 1 }]],
  ['hronautSidebarOverlayView', 'pointer', [{ hovered: true, held: false }], 'sidebar-overlay-view:pointer', [{ hovered: true, held: false }]],
  ['hronautSidebarOverlayView', 'intent', [{ kind: 'open-home' }], 'sidebar-overlay-view:intent', [{ kind: 'open-home' }]],
  ['hronautSidebarOverlayView', 'showTooltip', [{ id: 1, text: 'Pin' }], 'sidebar-overlay-view:tooltip-show', [{ id: 1, text: 'Pin' }]],
  ['hronautSidebarOverlayView', 'hideTooltip', [1], 'sidebar-overlay-view:tooltip-hide', [1]],
  ['hronautSidebarOverlayView', 'hideTooltip', [], 'sidebar-overlay-view:tooltip-hide', [undefined]],
  ['hronautTooltipOverlayView', 'measured', [{ id: 1 }], 'tooltip-overlay:measured', [{ id: 1 }]],
  ['hronautStatusBubbleView', 'measured', [{ id: 1 }], 'status-bubble:measured', [{ id: 1 }]],
  ['hronautShell', 'setToolbarHeight', [40], 'browser:toolbar-height', [40]],
  ['hronautShell', 'setContentInsets', [{ top: 0, right: 0, bottom: 0, left: 240 }], 'browser:content-insets', [{ top: 0, right: 0, bottom: 0, left: 240 }]],
  ['hronautShell', 'setBrowserContentOccluded', [true, 2], 'browser:content-occluded', [true, 2]],
  ['hronautShell', 'presentOcclusionSnapshot', [5], 'browser:occlusion-snapshot-presented', [5]],
  ['hronautShell', 'setWindowControlsScrim', ['rgba(0, 0, 0, 0.5)'], 'shell:window-controls-scrim', ['rgba(0, 0, 0, 0.5)']],
  ['hronautShell', 'setWindowControlsScrim', [null], 'shell:window-controls-scrim', [null]],
  ['hronautShell', 'setFollowAgentActivitySuspended', [true], 'browser:follow-agent-activity-suspended', [true]],
  ['hronautTrustedDialogs', 'ready', [], 'trusted-dialogs:ready', []],
  ['hronautTrustedDialogs', 'respond', ['dialog-1', 0], 'trusted-dialogs:respond', ['dialog-1', 0]],
  // Only the name and password go to main, whatever else the object holds.
  ['hronautTrustedDialogs', 'respond', ['dialog-1', 1, { username: 'name', password: 'secret', extra: true }], 'trusted-dialogs:respond', ['dialog-1', 1, { username: 'name', password: 'secret' }]]
]

it.each(sends)('%s.%s tells main on its channel with its arguments', async (api, method, args, channel, sent) => {
  const call = await exposed(api, method)
  expect(call(...args)).toBeUndefined()
  expect(electron.send).toHaveBeenCalledExactlyOnceWith(channel, ...sent)
  expect(electron.invoke).not.toHaveBeenCalled()
})

// Each listener the shell registers, with the channel main sends on and what the listener receives of it.
const listeners: Array<[api: string, method: string, channel: string, received: unknown[]]> = [
  ['hronaut', 'onStateChanged', 'browser:state-changed', [browserState]],
  ['hronaut', 'onMcpTabActivity', 'browser:mcp-tab-activity', [{ activityId: 'activity-1', tabId: 'tab-1', toolName: 'browser_click', phase: 'started', occurredAt: 1 }]],
  ['hronaut', 'onUndoOffered', 'undo:offered', [{ token: undoToken, kind: 'tabs-closed', name: 'Docs', count: 2 }]],
  ['hronaut', 'onUndoEnded', 'undo:ended', [undoToken]],
  ['hronaut', 'onUserAttentionChanged', 'attention:changed', [{ id: 'attention-1', requestedAt: '2026-10-30T08:00:00.000Z', reason: 'Sign in to continue', tabId: 'tab-1' }]],
  ['hronaut', 'onUserAttentionRequested', 'attention:requested', []],
  ['hronaut', 'onQrCodeRequested', 'browser:qr-code-requested', [{ tabId: 'tab-1', address: 'https://example.com/' }]],
  ['hronaut', 'onShortcutRequested', 'browser:shortcut-requested', ['command-palette']],
  ['hronaut', 'onHomeWorkspaceEditorRequested', 'browser:home-workspace-editor', [{ view: 'import', workspaceId: 'workspace-1' }]],
  ['hronaut', 'onTabGroupEditRequested', 'browser:edit-tab-group', ['workspace-1']],
  ['hronaut', 'onNewTabRequested', 'browser:new-tab-requested', ['workspace-1']],
  ['hronaut', 'onVisitHistoryRequested', 'browser:visit-history-requested', []],
  ['hronaut', 'onAddressPasteAndGo', 'browser:address-paste-and-go', ['https://example.com/']],
  ['hronautLicense', 'onChanged', 'license:changed', [{ status: 'trial' }]],
  ['hronautUpdates', 'onChanged', 'updates:changed', [{ status: 'idle' }]],
  ['hronautUpdates', 'onOpenRequested', 'updates:open', []],
  ['hronautPermissions', 'onChanged', 'permissions:changed', [[{ origin: 'https://a.test' }]]],
  ['hronautCredentials', 'onChanged', 'credentials:changed', [[{ id: 'credential-1' }]]],
  ['hronautCredentials', 'onStatusChanged', 'credentials:status-changed', [{ available: true }]],
  ['hronautDownloads', 'onChanged', 'browser:downloads-changed', [[{ id: 'download-1' }]]],
  ['hronautBookmarks', 'onChanged', 'bookmarks:changed', [[{ id: 'bookmark-1' }]]],
  ['hronautBookmarks', 'collections.onChanged', 'bookmark-collections:changed', [{ revision: 1, collections: [] }]],
  ['hronautHistory', 'onChanged', 'visit-history:changed', [[{ id: 'entry-1' }]]],
  ['hronautHistory', 'onUpdated', 'visit-history:updated', [{ entries: [], removedIds: ['entry-1'] }]],
  ['hronautMcp', 'onChanged', 'mcp:changed', [{ paused: false }]],
  ['hronautWallets', 'onChanged', 'wallets:changed', [[{ id: 'wallet-1' }]]],
  ['hronautWallets', 'onStatusChanged', 'wallets:status-changed', [{ managedWallets: 'locked', backend: 'keyring', watchOnlyAvailable: true }]],
  ['hronautWallets', 'onRequestsChanged', 'wallets:requests-changed', [[{ id: 'request-1' }]]],
  ['hronautSettings', 'onChanged', 'settings:changed', [{ theme: 'dark' }]],
  ['hronautSettings', 'onSystemThemeChanged', 'settings:system-theme-changed', ['light']],
  ['hronautAddressOverlay', 'onSelected', 'address-overlay:selected', [{ sessionId: 1, suggestionId: 's-1' }]],
  ['hronautAddressOverlay', 'onDismissed', 'address-overlay:dismissed', [1]],
  ['hronautAgentCard', 'onEvent', 'agent-card:event', [{ cardId: 1, kind: 'closed', reason: 'escape' }]],
  ['hronautToastOverlay', 'onEvent', 'toast-overlay:event', [{ id: 1, kind: 'shown' }]],
  ['hronautSidebarOverlay', 'onEvent', 'sidebar-overlay:event', [{ id: 1, kind: 'shown' }]],
  ['hronautAddressOverlayView', 'onState', 'address-overlay:state', [{ sessionId: 1, suggestions: [] }]],
  ['hronautAgentCardView', 'onState', 'agent-card-view:state', [{ cardId: 1, revision: 1 }]],
  ['hronautToastOverlayView', 'onState', 'toast-overlay-view:state', [{ revision: 1, width: 360 }]],
  ['hronautSidebarOverlayView', 'onState', 'sidebar-overlay-view:state', [{ revision: 1 }]],
  ['hronautTooltipOverlayView', 'onState', 'tooltip-overlay:state', [{ id: 1, text: 'Back' }]],
  ['hronautStatusBubbleView', 'onState', 'status-bubble:state', [{ id: 1, maxWidth: 300 }]],
  ['hronautShell', 'onOcclusionSnapshot', 'browser:occlusion-snapshot', [null]],
  ['hronautShell', 'onOcclusionPagesHidden', 'browser:occlusion-pages-hidden', [2]],
  ['hronautShell', 'onHelpRequested', 'help:open', ['about']],
  ['hronautShell', 'onClipboardFailed', 'clipboard:failed', ['Copying failed']],
  ['hronautShell', 'onActionFailed', 'browser:action-failed', [{ action: 'reload', message: 'Failed' }]],
  ['hronautPanelWindow', 'onActivePanelChanged', 'panel-window:active-panel', ['network']],
  ['hronautPanelWindow', 'onRedockRequested', 'panel-window:redock-requested', [{ panel: 'bookmarks', dock: 'left' }]],
  ['hronautPanelWindow', 'onClosed', 'panel-window:closed', []],
  ['hronautSplitDivider', 'onChanged', 'split-divider:changed', [null]],
  ['hronautEmulationFrame', 'onChanged', 'emulation-frame:changed', [[]]],
  ['hronautPageCard', 'onChanged', 'page-card:changed', [[]]],
  ['hronautAgentPresence', 'onChanged', 'agent-presence:changed', [{ revision: 1, workspaces: {} }]],
  ['hronautAgentPresence', 'onTakeOverOffer', 'agent-presence:take-over-offer', [{ tabId: 'tab-1', clientKey: 'AbCdEfGhIjKlMnOpQrStUv' }]],
  ['hronautTrustedDialogs', 'onChanged', 'trusted-dialogs:changed', [null, { afterInterruptedSignIn: true }]],
  ['hronautSettings', 'onRendererStateChanged', 'settings:renderer-state-changed', [{ settings: { theme: 'dark' }, systemTheme: 'dark', systemLocale: 'en-US', resolvedLocale: 'en-US' }]]
]

it.each(listeners)('%s.%s passes on only what the channel carries, without the event or extras, until it is stopped', async (api, method, channel, received) => {
  const subscribe = await exposed(api, method)
  const listener = vi.fn()
  const stop = subscribe(listener) as () => void
  const [, handler] = electron.on.mock.calls.find(([name]) => name === channel)!
  handler({ sender: 'event' }, ...received, 'extra')
  expect(listener.mock.calls).toEqual([received])
  expect(stop()).toBeUndefined()
  expect(electron.removeListener).toHaveBeenCalledExactlyOnceWith(channel, handler)
})

it('hronautShell.windowChrome describes the window the preload runs in', async () => {
  await import('../src/preload/index.js')
  const shell = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'hronautShell')?.[1] as { windowChrome: unknown }
  const platform = process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux'
  expect(shell.windowChrome).toEqual({ platform, mode: 'system', mainWindow: true })
})

it('hronautShell.confirm is true only when main answers true', async () => {
  const confirm = await exposed('hronautShell', 'confirm')
  const question = { message: 'Close all tabs?' }
  electron.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce('yes').mockResolvedValueOnce(false)
  await expect(confirm(question)).resolves.toBe(true)
  await expect(confirm(question)).resolves.toBe(false)
  await expect(confirm(question)).resolves.toBe(false)
  expect(electron.invoke.mock.calls).toEqual([['shell:confirm', question], ['shell:confirm', question], ['shell:confirm', question]])
})

it('hronautShell.onOcclusionPagesHidden passes on only a request number', async () => {
  const subscribe = await exposed('hronautShell', 'onOcclusionPagesHidden')
  const listener = vi.fn()
  subscribe(listener)
  const [, handler] = electron.on.mock.calls.find(([name]) => name === 'browser:occlusion-pages-hidden')!
  handler({}, '2')
  handler({}, 3)
  expect(listener.mock.calls).toEqual([[3]])
})

it('hronautTrustedDialogs.onChanged passes on only whether a sign-in was just interrupted', async () => {
  const subscribe = await exposed('hronautTrustedDialogs', 'onChanged')
  const listener = vi.fn()
  subscribe(listener)
  const [, handler] = electron.on.mock.calls.find(([name]) => name === 'trusted-dialogs:changed')!
  const request = { id: 'dialog-1', type: 'question', message: 'Leave site?', buttons: ['Leave', 'Cancel'], defaultId: 0, cancelId: 1, variant: { kind: 'message' } }
  handler({}, request)
  handler({}, request, { afterInterruptedSignIn: 'yes', extra: true })
  handler({}, null, { afterInterruptedSignIn: true })
  expect(listener.mock.calls).toEqual([[request, { afterInterruptedSignIn: false }], [request, { afterInterruptedSignIn: false }], [null, { afterInterruptedSignIn: true }]])
})

it('hronautPanelWindow keeps the panel main asked for until the shell listens', async () => {
  const onPanelRequested = await exposed('hronautPanelWindow', 'onPanelRequested')
  const [, handler] = electron.on.mock.calls.find(([name]) => name === 'panel-window:show-panel')!
  handler({}, 'network')
  handler({}, 'console')
  const listener = vi.fn()
  onPanelRequested(listener)
  handler({}, 'bookmarks')
  expect(listener.mock.calls).toEqual([['console'], ['bookmarks']])
})

it('hronaut sends main copies of the tab lists it is given', async () => {
  const tabIds = ['tab-1', 'tab-2']
  for (const [method, args] of [['closeTabs', [tabIds]], ['reorderTabs', [tabIds, 'tab-3', 'after']], ['showTabContextMenu', ['tab-1', tabIds]]] as const) {
    await (await exposed('hronaut', method))(...args)
  }
  const sentLists = electron.invoke.mock.calls.map((call) => call.find(Array.isArray))
  expect(sentLists).toEqual([tabIds, tabIds, tabIds])
  for (const sent of sentLists) expect(sent).not.toBe(tabIds)
})

it('hronaut.onQrCodeRequested passes on only a tab and an address', async () => {
  const subscribe = await exposed('hronaut', 'onQrCodeRequested')
  const listener = vi.fn()
  subscribe(listener)
  const [, handler] = electron.on.mock.calls.find(([name]) => name === 'browser:qr-code-requested')!
  handler({}, null)
  handler({}, { tabId: 1, address: 'https://example.com/' })
  handler({}, { tabId: 'tab-1', address: 'https://example.com/', text: 'extra' })
  expect(listener.mock.calls).toEqual([[{ tabId: 'tab-1', address: 'https://example.com/' }]])
})

it('checks at compile time that calls and listeners match their channel', () => {
  const ask = 'example:ask' as InvokeChannel<[id: string], number>
  const changed = 'example:changed' as EventChannel<[count: number]>
  const tell = 'example:tell' as SendChannel<[id: string, count?: number]>
  const typeOnly = async (): Promise<void> => {
    const { invoke, send, subscribe } = await import('../src/preload/bridges/ipc.js')
    const answer: number = await invoke(ask, 'id-1')
    // @ts-expect-error The answer is a number.
    const wrongAnswer: string = await invoke(ask, 'id-1')
    // @ts-expect-error The argument is a string.
    void invoke(ask, 1)
    // @ts-expect-error The argument is required.
    void invoke(ask)
    // @ts-expect-error The channel takes one argument.
    void invoke(ask, 'id-1', 'extra')
    // @ts-expect-error The channel decides the argument's type; a value of unknown type does not widen it.
    void invoke(ask, JSON.parse('"id-1"') as unknown)
    // @ts-expect-error The listener receives a number.
    subscribe(changed, (count: string) => count)
    send(tell, 'id-1')
    send(tell, 'id-1', 2)
    // @ts-expect-error The second argument is a number.
    send(tell, 'id-1', '2')
    // @ts-expect-error The first argument is required.
    send(tell)
    void [answer, wrongAnswer]
  }
  expect(typeof typeOnly).toBe('function')
})
