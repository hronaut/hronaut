/**
 * Wraps document.ariaNotify and Element.ariaNotify in the top-level document so each call reports to Hronaut through
 * the debugger binding of this name, then calls the original. The binding is taken off the page's global object at
 * once, and the original is kept on the wrapper under the binding's symbol, so stopping can put it back. Returns
 * whether ariaNotify exists here; frames are never wrapped.
 */
export function installAriaNotifyRecorder(binding: string): { supported: boolean; installed: boolean } {
  const global = globalThis as unknown as Record<string, unknown>
  const send = global[binding]
  try {
    delete global[binding]
  } catch {
    // A binding the page made unconfigurable stays; it only reaches Hronaut's own recorder.
  }
  const supported = typeof (Element.prototype as unknown as Record<string, unknown>).ariaNotify === 'function'
  if (window !== window.top || typeof send !== 'function' || !supported) return { supported, installed: false }
  const key = Symbol.for(binding)
  const report = send as (message: string) => void
  let installed = false
  for (const proto of [Element.prototype, Document.prototype] as unknown as Array<Record<string, unknown>>) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'ariaNotify')
    const original = descriptor?.value
    if (typeof original !== 'function' || (original as unknown as Record<symbol, unknown>)[key]) continue
    const wrapped = function (this: unknown, announcement: unknown, options?: unknown): unknown {
      try {
        const element = this instanceof Element ? this : undefined
        const priority = options !== null && typeof options === 'object' ? (options as { priority?: unknown }).priority : undefined
        report(JSON.stringify({
          text: typeof announcement === 'string' ? announcement.slice(0, 2000) : String(announcement).slice(0, 2000),
          priority: typeof priority === 'string' ? priority.slice(0, 16) : undefined,
          localName: element?.localName,
          role: element?.getAttribute('role')?.slice(0, 64) ?? undefined,
          // The first line is the message and the second this wrapper.
          stack: String(new Error().stack ?? '').split('\n').slice(2, 3).join('').slice(0, 2000),
          url: location.href
        }))
      } catch {
        // Recording never changes what the page's call does.
      }
      return Reflect.apply(original as (...args: unknown[]) => unknown, this, [announcement, options].slice(0, arguments.length))
    }
    Object.defineProperty(wrapped, key, { value: original })
    Object.defineProperty(proto, 'ariaNotify', { ...descriptor, value: wrapped })
    installed = true
  }
  return { supported, installed }
}

/** Puts back the ariaNotify functions the recorder with this binding wrapped. */
export function removeAriaNotifyRecorder(binding: string): boolean {
  const key = Symbol.for(binding)
  let removed = false
  for (const proto of [Element.prototype, Document.prototype] as unknown as Array<Record<string, unknown>>) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'ariaNotify')
    const original = (descriptor?.value as Record<symbol, unknown> | undefined)?.[key]
    if (!descriptor || typeof original !== 'function') continue
    Object.defineProperty(proto, 'ariaNotify', { ...descriptor, value: original })
    removed = true
  }
  return removed
}
