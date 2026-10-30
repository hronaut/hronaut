import type { Confirmation } from '../confirmation.js'
import type { BrowserActionFailure, BrowserOcclusionSnapshot, HelpMenuAction } from '../types.js'
import type { EventChannel, InvokeChannel, SendChannel } from './channel.js'

/** The shell's own window: its layout over the pages, the dialogs it covers them with, and what main tells it. */
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
  actionFailed: 'browser:action-failed' as EventChannel<[failure: BrowserActionFailure]>
} as const
