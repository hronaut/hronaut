/**
 * The contract between the main process and the shell for Hronaut's own in-app dialogs: questions main asks the
 * person, such as a website's permission request, that the shell draws over the page instead of a system dialog.
 * Main stays the authority: it decides what is asked and which answer counts, and the shell only mirrors the one
 * dialog main shows it and reports the button the person chose.
 */

/** The icon and tone of a dialog with no design of its own, as Electron's message box `type` names them. */
export type TrustedDialogType = 'none' | 'info' | 'error' | 'question' | 'warning'

/** What a website asked for, for the shell to design its prompt; each field is plain data main already checked. */
export interface SitePermissionDialogVariant {
  kind: 'site-permission'
  /** The website that asks, as an origin such as https://example.com. */
  origin: string
  /** The website of the page around the asking frame, when it is another website. */
  embeddedIn?: string
  /** Chromium's name for the permission, such as "geolocation" or "media". */
  permission: string
  /** For "media": the devices asked for. */
  mediaTypes?: Array<'audio' | 'video'>
  /** The workspace the choice belongs to, as the prompt names it, when Hronaut knows it. */
  workspaceName?: string
  /** True for a permission Hronaut never remembers, such as the camera: it asks every time. */
  freshConsent: boolean
  /** For "fileSystem": the file or folder and the access asked for. */
  file?: { path: string, access: 'readable' | 'writable' | 'unspecified' }
  /** For "openExternal": the link's scheme, already shortened for display. */
  externalScheme?: string
}

/** A website's picker or a dropped folder gave it a location Hronaut never gives. */
export interface ProtectedFileAccessDialogVariant {
  kind: 'protected-file-access'
  origin: string
  target: 'file' | 'folder'
}

/** A dialog with no design of its own: the message, detail and buttons as given. */
export interface MessageDialogVariant {
  kind: 'message'
}

export type TrustedDialogVariant = SitePermissionDialogVariant | ProtectedFileAccessDialogVariant | MessageDialogVariant

/** The one dialog main shows a shell window, as that window draws it. */
export interface TrustedDialogRequest {
  /** Names this request; an answer for any other id is ignored. */
  id: string
  type: TrustedDialogType
  title?: string
  message: string
  detail?: string
  /** The button labels, in the order their indexes answer. */
  buttons: string[]
  /** The button that takes the focus, as Enter would press it. */
  defaultId: number
  /** The answer Escape, the close button and a dialog that goes away give. */
  cancelId: number
  /** The button drawn as the main action, if any; never the cancel button. */
  primaryId?: number
  variant: TrustedDialogVariant
}

export const TRUSTED_DIALOG_CHANNELS = {
  /** Shell → main: the shell can draw dialogs now, and wants the current one. */
  ready: 'trusted-dialogs:ready',
  /** Shell → main: the person chose a button of a request. */
  respond: 'trusted-dialogs:respond',
  /** Main → shell: the dialog to show, or null for none. */
  changed: 'trusted-dialogs:changed'
} as const

/** The bridge the trusted shell uses; websites never get it. */
export interface HronautTrustedDialogsApi {
  ready(): void
  respond(id: string, response: number): void
  onChanged(listener: (request: TrustedDialogRequest | null) => void): () => void
}
