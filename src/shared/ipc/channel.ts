declare const contract: unique symbol

/**
 * A channel a renderer invokes with these arguments, which main answers with the result. The value is the plain
 * channel name, so the wire stays the same; the types only tell both sides what goes over it.
 */
export type InvokeChannel<Args extends unknown[], Result> = string & { readonly [contract]?: { invoke: Args; result: Result } }

/** A channel main sends these arguments on to a renderer. */
export type EventChannel<Args extends unknown[]> = string & { readonly [contract]?: { event: Args } }

/**
 * Sends an event on a channel with the arguments it takes, as main's sendToShellWindows does to the main and the
 * detached panel window, and sendToMainWindow to the main window alone.
 */
export type EventSender = <Args extends unknown[]>(channel: EventChannel<Args>, ...args: NoInfer<Args>) => void
