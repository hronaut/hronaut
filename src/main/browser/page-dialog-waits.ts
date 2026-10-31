// A print dialog or a website dialog holds the page until the person closes or answers it, and Hronaut's guards fail
// the page calls it holds. A few calls wait on the page for the person by design, and a dialog only pauses them.

let callingThroughDialogs = false

/**
 * Makes a call that waits on the page for the person, such as the watch for a submitted sign-in form or Hronaut's
 * element picker, outside the holds of the page's print and website dialogs: a dialog only pauses it until the person
 * is done with it, so it is neither failed nor refused. The call is made at once.
 */
export function callThroughPageDialogs<T>(call: () => Promise<T>): Promise<T> {
  callingThroughDialogs = true
  try {
    return call()
  } finally {
    callingThroughDialogs = false
  }
}

/** Whether the page call being made now comes through callThroughPageDialogs; the guards wrap the calls synchronously. */
export function callingThroughPageDialogs(): boolean {
  return callingThroughDialogs
}
