declare const contract: unique symbol

/**
 * A channel a renderer invokes with these arguments, which main answers with the result. The value is the plain
 * channel name, so the wire stays the same; the types only tell both sides what goes over it.
 */
export type InvokeChannel<Args extends unknown[], Result> = string & { readonly [contract]?: { invoke: Args; result: Result } }

/** A channel a renderer sends these arguments on, which main does not answer. */
export type SendChannel<Args extends unknown[]> = string & { readonly [contract]?: { send: Args } }

/** A channel main sends these arguments on to a renderer. */
export type EventChannel<Args extends unknown[]> = string & { readonly [contract]?: { event: Args } }

/** Sends an event to every shell window, the main window and open panel windows, with the arguments its channel takes. */
export type ShellWindowsSender = <Args extends unknown[]>(channel: EventChannel<Args>, ...args: Args) => void
