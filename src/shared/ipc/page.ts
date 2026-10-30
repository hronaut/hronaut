import type { PageExceptionPayload } from '../console-exceptions.js'
import type { PageBootstrap } from '../page-bootstrap.js'
import type { EventChannel, SendChannel, SyncChannel } from './channel.js'

/** What a website's page preload and main tell each other about the page itself. */
export const PAGE_IPC = {
  /**
   * Website → main, waiting for the answer: what Hronaut installs in a new top-level HTTP(S) document before its
   * scripts run, React inspection and a fixed Date. Embedded frames are never answered with either.
   */
  bootstrap: 'page:bootstrap' as SyncChannel<[], PageBootstrap | undefined>,
  /** Main → website: React inspection was turned off for the tab, so the installed inspection stops. */
  reactInspectionDisable: 'react-inspection:disable' as EventChannel<[]>,
  /** Website → main: an exception the page did not catch, or a promise rejection it did not handle, for its console. */
  exception: 'hronaut:page-exception' as SendChannel<[exception: PageExceptionPayload]>,
  /**
   * Website → main: the page's print dialog opened (true, on the browser's beforeprint) or closed (false, on
   * afterprint). Main then stops waiting on a page the dialog holds.
   */
  printDialog: 'hronaut:page-print' as SendChannel<[open: boolean]>
} as const
