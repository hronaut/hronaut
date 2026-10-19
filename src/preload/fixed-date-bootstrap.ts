/**
 * Replaces the page's global Date with one whose current-time reads return a
 * fixed instant: `Date.now()`, `new Date()` and callable `Date()`. Everything
 * else is the native Date: explicit arguments, parsing, `Date.UTC`, the
 * prototype, subclasses and instanceof. Timers, `performance.now` and
 * `Intl` formatting without a date keep the real clock.
 *
 * This function is serialized into the main world before page scripts run.
 * Keep all runtime dependencies inside it and capture intrinsics first.
 */
export function installFixedDate(epochMs: number): void {
  const NativeDate = Date
  const construct = Reflect.construct
  const apply = Reflect.apply
  const defineProperty = Object.defineProperty
  const nativeToString = NativeDate.prototype.toString
  const FixedDate = function Date(this: unknown, ...args: unknown[]): unknown {
    // Called without new, Date ignores its arguments and returns the current time as a string.
    if (new.target === undefined) return apply(nativeToString, construct(NativeDate, [epochMs]), [])
    return construct(NativeDate, args.length ? args : [epochMs], new.target)
  }
  const method = (value: unknown) => ({ value, writable: true, enumerable: false, configurable: true })
  defineProperty(FixedDate, 'length', { value: NativeDate.length, writable: false, enumerable: false, configurable: true })
  defineProperty(FixedDate, 'name', { value: 'Date', writable: false, enumerable: false, configurable: true })
  defineProperty(FixedDate, 'prototype', { value: NativeDate.prototype, writable: false, enumerable: false, configurable: false })
  // A method keeps its name when bundled, and like the native one has no prototype.
  defineProperty(FixedDate, 'now', method({ now() { return epochMs } }.now))
  defineProperty(FixedDate, 'parse', method(NativeDate.parse))
  defineProperty(FixedDate, 'UTC', method(NativeDate.UTC))
  defineProperty(NativeDate.prototype, 'constructor', method(FixedDate))
  defineProperty(globalThis, 'Date', method(FixedDate))
}
