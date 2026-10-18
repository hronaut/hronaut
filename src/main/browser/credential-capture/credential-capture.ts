import { credentialCapturePageScript } from '../credential-capture-page.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import { isHronautHomeUrl } from '../url.js'
import type { BrowserCredentialCandidate, CredentialCaptureAccess, CredentialCaptureTab } from './credential-capture-access.js'

/** The isolated world the submission watcher runs in, apart from the page's own scripts. */
const CREDENTIAL_CAPTURE_WORLD_ID = ISOLATED_WORLDS.credentialCapture

/**
 * Watches the website tab's page for a submitted sign-in form and reports the
 * credentials when the person interacted with the page in the last 15
 * seconds and the form's origin is a valid origin. After each submission it
 * watches again. Nothing is watched without a submission listener.
 */
export function watchCredentialSubmission(access: CredentialCaptureAccess, tab: CredentialCaptureTab): void {
  if (!access.options().onCredentialSubmitted || isHronautHomeUrl(tab.url) || tab.webContents.isDestroyed()) return
  const script = credentialCapturePageScript()
  void tab.webContents.executeJavaScriptInIsolatedWorld(CREDENTIAL_CAPTURE_WORLD_ID, [{ code: script }], false)
    .then((candidate: BrowserCredentialCandidate | null) => {
      if (!candidate) return
      watchCredentialSubmission(access, tab)
      if (Date.now() - tab.lastHumanInteractionAt > 15_000) return
      let currentOrigin: string | null = null
      try {
        currentOrigin = new URL(candidate.origin).origin
      } catch {
        return
      }
      if (currentOrigin !== candidate.origin || !candidate.password) return
      access.options().onCredentialSubmitted?.(candidate)
    })
    .catch(() => undefined)
}
