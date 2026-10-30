import { TRUSTED_DIALOGS_IPC } from '../../shared/ipc/trusted-dialogs.js'
import type { HronautTrustedDialogsApi, TrustedDialogShellState } from '../../shared/trusted-dialogs.js'
import { send, subscribe } from './ipc.js'

/** window.hronautTrustedDialogs: Hronaut's own dialogs, such as a website's permission request; main checks that this shell document answers. */
export const trustedDialogsApi: HronautTrustedDialogsApi = {
  ready: () => send(TRUSTED_DIALOGS_IPC.ready),
  // Main takes what the person typed to sign in only with the answer that signs in to the sign-in dialog it shows.
  respond: (id, response, credentials) => credentials
    ? send(TRUSTED_DIALOGS_IPC.respond, id, response, { username: credentials.username, password: credentials.password })
    : send(TRUSTED_DIALOGS_IPC.respond, id, response),
  onChanged: (listener) => subscribe(TRUSTED_DIALOGS_IPC.changed, (request, state?: TrustedDialogShellState) => (
    listener(request, { afterInterruptedSignIn: state?.afterInterruptedSignIn === true })
  ))
}
