import type { TrustedDialogCredentials, TrustedDialogRequest, TrustedDialogShellState } from '../trusted-dialogs.js'
import type { EventChannel, SendChannel } from './channel.js'

/** Hronaut's own dialogs, such as a website's permission request, which a shell draws over its window. */
export const TRUSTED_DIALOGS_IPC = {
  /** Shell → main: the shell can draw dialogs now, and wants the current one. */
  ready: 'trusted-dialogs:ready' as SendChannel<[]>,
  /** Shell → main: the person chose a button of a request, with what they typed to sign in when they sign in. */
  respond: 'trusted-dialogs:respond' as SendChannel<[id: string, response: number, credentials?: TrustedDialogCredentials]>,
  /** Main → shell: the dialog to show, or null for none, with the shell's state then. */
  changed: 'trusted-dialogs:changed' as EventChannel<[request: TrustedDialogRequest | null, state: TrustedDialogShellState]>
} as const
