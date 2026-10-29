import type { WebContents } from 'electron'

/** Credentials the person submitted in a website's sign-in form. */
export interface BrowserCredentialCandidate {
  origin: string
  username: string
  password: string
  /** The current password a form that changes one gave, when it names no account. */
  previousPassword?: string
}

/** The tab fields watching for submitted credentials reads: its address, its page and the person's last interaction with it. */
export interface CredentialCaptureTab {
  url: string
  webContents: WebContents
  lastHumanInteractionAt: number
}

/** The tab manager option that receives submitted credentials. */
export interface CredentialCaptureOptions {
  onCredentialSubmitted?: (candidate: BrowserCredentialCandidate) => void
}

/** What watching for submitted credentials needs from the tab manager, which keeps its options private. */
export interface CredentialCaptureAccess {
  /** The tab manager's options, read again when a submission arrives. */
  options(): CredentialCaptureOptions
}
