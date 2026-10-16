import { nextTick, onScopeDispose, watch, type Ref, type WatchSource } from 'vue'
import { parseScrimColor, type ScrimColor } from '../../../shared/title-bar.js'

/** Lays `top` over `bottom` as the compositor does. */
function over(top: ScrimColor, bottom: ScrimColor): ScrimColor {
  const alpha = top.alpha + bottom.alpha * (1 - top.alpha)
  const channel = (upper: number, lower: number) => (
    (upper * top.alpha + lower * bottom.alpha * (1 - top.alpha)) / alpha
  )
  return {
    red: channel(top.red, bottom.red),
    green: channel(top.green, bottom.green),
    blue: channel(top.blue, bottom.blue),
    alpha
  }
}

/**
 * The translucent backdrops drawn at the window's top-right corner, where the
 * native window controls sit, combined into one color, or null when no dialog
 * backdrop covers it.
 */
export function readWindowControlsScrim(): string | null {
  // Documents without layout, such as test DOMs, cannot hit-test.
  if (typeof document.elementsFromPoint !== 'function') return null
  let combined: ScrimColor | null = null
  for (const element of document.elementsFromPoint(Math.max(0, window.innerWidth - 2), 2)) {
    const style = getComputedStyle(element)
    // Nothing under an opaque surface shows through to the controls.
    if (style.backgroundColor.startsWith('rgb(')) break
    const layer = style.position === 'fixed' ? parseScrimColor(style.backgroundColor) : null
    // Elements come topmost first, so each backdrop found lies under the ones before it.
    if (layer) combined = combined ? over(combined, layer) : layer
  }
  if (!combined) return null
  const { red, green, blue, alpha } = combined
  return `rgba(${Math.round(red)}, ${Math.round(green)}, ${Math.round(blue)}, ${Math.min(0.999, Number(alpha.toFixed(3)))})`
}

interface WindowControlsScrimOptions {
  /** Open states of the dialogs that draw a backdrop over the whole window. */
  sources: WatchSource<unknown>[]
  /** True while a closed dialog's exit still keeps the page hidden behind its backdrop. */
  exitHoldsPage?: Readonly<Ref<boolean>>
  report(color: string | null): void
  read?: () => string | null
}

/** Keeps the native window controls dimmed with the open dialogs' backdrops. */
export function useWindowControlsScrim(options: WindowControlsScrimOptions) {
  const read = options.read ?? readWindowControlsScrim
  let reported: string | null = null
  let disposed = false
  const exitHoldsPage = options.exitHoldsPage
  const stop = watch(exitHoldsPage ? [...options.sources, exitHoldsPage] : options.sources, async () => {
    // Read the backdrop once the dialog that changed is in the DOM.
    await nextTick()
    if (disposed) return
    const next = read()
    // A leaving backdrop is inert and no longer hit-tests; the controls come back with the page, not before.
    if (next === null && exitHoldsPage?.value) return
    if (next === reported) return
    reported = next
    options.report(next)
  })

  function dispose(): void {
    if (disposed) return
    disposed = true
    stop()
    if (reported !== null) options.report(null)
    reported = null
  }
  onScopeDispose(dispose)
  return { dispose }
}
