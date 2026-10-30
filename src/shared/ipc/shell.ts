import type { Confirmation } from '../confirmation.js'
import type { BrowserShortcutAction } from '../browser-shortcuts.js'
import type { HomeWorkspaceEditorRequest } from '../home-workspaces.js'
import type { BrowserActionFailure, BrowserOcclusionSnapshot, HelpMenuAction } from '../types.js'
import type { EventChannel, InvokeChannel, SendChannel } from './channel.js'

/** The shell's own window and the app's: its layout over the pages, the dialogs it covers them with, Quit, the clipboard, and what main tells it or asks of it. */
export const SHELL_IPC = {
  /** Shell → main: whether the shell's window has the focus. */
  isWindowFocused: 'shell:is-window-focused' as InvokeChannel<[], boolean>,
  /** Shell → main: asks in Hronaut's own dialog over the window, or the system's when the shell cannot show one; true only when the person chose OK. */
  confirm: 'shell:confirm' as InvokeChannel<[question: Confirmation], boolean>,
  /** Main window → main: the toolbar's height, in the shell's CSS pixels, which the pages go below. */
  toolbarHeight: 'browser:toolbar-height' as SendChannel<[height: number]>,
  /** Main window → main: how far the pages keep in from each side, in CSS pixels, as for a docked panel. */
  contentInsets: 'browser:content-insets' as SendChannel<[insets: { top: number; right: number; bottom: number; left: number }]>,
  /** Main window → main: hides or shows the page views under trusted chrome, for the request with this number. */
  contentOccluded: 'browser:content-occluded' as SendChannel<[occluded: boolean, request: number]>,
  /** Main → main window: a still image of the pages to show while trusted chrome covers them, or null for none. */
  occlusionSnapshot: 'browser:occlusion-snapshot' as EventChannel<[snapshot: BrowserOcclusionSnapshot | null]>,
  /** Main window → main: the still image with this id is on screen, so main can hide the page views. */
  occlusionSnapshotPresented: 'browser:occlusion-snapshot-presented' as SendChannel<[id: number]>,
  /** Main → main window: the page views are hidden, for the request with this number. */
  occlusionPagesHidden: 'browser:occlusion-pages-hidden' as EventChannel<[request: number]>,
  /** Main window → main: the open dialog's backdrop color, or null, so the native window controls dim with it. */
  windowControlsScrim: 'shell:window-controls-scrim' as SendChannel<[color: string | null]>,
  /** Main window → main: whether the shell holds off following agent activity, as while the address field has focus. */
  followAgentActivitySuspended: 'browser:follow-agent-activity-suspended' as SendChannel<[suspended: boolean]>,
  /** Main → main window: a Help dialog or a part of Settings to show, as a menu item asks. */
  helpRequested: 'help:open' as EventChannel<[action: HelpMenuAction]>,
  /** Main → main window: copying to the clipboard failed, with the message to show. */
  clipboardFailed: 'clipboard:failed' as EventChannel<[message: string]>,
  /** Main → main window: an action the person asked for failed, to show in a toast. */
  actionFailed: 'browser:action-failed' as EventChannel<[failure: BrowserActionFailure]>,
  /** Shell → main: shows and focuses the app's window. */
  show: 'browser:show' as InvokeChannel<[], void>,
  /** Shell → main: quits the app. */
  quit: 'browser:quit' as InvokeChannel<[], void>,
  /** Shell → main: copies the text to the clipboard. */
  copyText: 'browser:copy-text' as InvokeChannel<[text: string], void>,
  /** Main → main window: a menu item or shortcut that the shell carries out. */
  shortcutRequested: 'browser:shortcut-requested' as EventChannel<[action: BrowserShortcutAction]>,
  /** Main → main window: opens Home's workspace editor, as a workspace's menu or Home's page asks. */
  homeWorkspaceEditorRequested: 'browser:home-workspace-editor' as EventChannel<[request: HomeWorkspaceEditorRequest]>,
  /** Main → main window: a workspace's menu asked to edit its tab group. */
  tabGroupEditRequested: 'browser:edit-tab-group' as EventChannel<[groupId: string]>,
  /** Main → main window: a menu asked for a new tab in the workspace, or in the active tab's workspace when it names none. */
  newTabRequested: 'browser:new-tab-requested' as EventChannel<[workspaceId: string | undefined]>,
  /** Main → main window: Show Full History in Back's or Forward's list asked for the history panel. */
  visitHistoryRequested: 'browser:visit-history-requested' as EventChannel<[]>,
  /** Main → shell: a tab's menu asked to bookmark the open tabs of its workspace, or of no workspace for null. */
  bookmarkAllTabsRequested: 'browser:bookmark-all-tabs-requested' as EventChannel<[workspaceId: string | null]>,
  /** Main → main window: Paste and Go or Paste and Search in the address field's menu, with the clipboard text to open. */
  addressPasteAndGo: 'browser:address-paste-and-go' as EventChannel<[text: string]>
} as const
