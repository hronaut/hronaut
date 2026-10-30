import type { AppReleaseHistoryPage, AppUpdateState } from '../types.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** Hronaut's own updates and release history, for the About and update panels. */
export const UPDATES_IPC = {
  /** Shell → main: the update state. */
  getState: 'updates:get-state' as InvokeChannel<[], AppUpdateState>,
  /** Shell → main: a page of published releases, newest first; bypassCache reads them again. */
  getReleaseHistory: 'updates:get-release-history' as InvokeChannel<[page: number, bypassCache: boolean], AppReleaseHistoryPage>,
  /** Shell → main: checks for an update now. */
  check: 'updates:check' as InvokeChannel<[], AppUpdateState>,
  /** Shell → main: downloads the update found. */
  download: 'updates:download' as InvokeChannel<[], AppUpdateState>,
  /** Shell → main: installs the downloaded update and restarts; false when it cannot install now. */
  install: 'updates:install' as InvokeChannel<[], boolean>,
  /** Main → shells: the update state changed. */
  changed: 'updates:changed' as EventChannel<[state: AppUpdateState]>,
  /** Main → main window: open the updates panel, as from the menu or the tray. */
  open: 'updates:open' as EventChannel<[]>
}
