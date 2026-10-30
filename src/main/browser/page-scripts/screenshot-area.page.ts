/** A viewport or page rectangle in CSS pixels. */
interface AreaClip { x: number; y: number; width: number; height: number }

/** The area the person dragged, or that they cancelled. */
export type ScreenshotAreaSelection = { canceled: true } | {
  canceled: false
  clip: AreaClip
  pageClip: AreaClip
  viewport: { width: number; height: number }
  url: string
}

/** The running picker's controls, kept on the page under its key. */
interface ScreenshotAreaControl {
  cancel: () => void
  nativeInput: (type: string, x: unknown, y: unknown) => boolean
}

type AreaPage = Window & typeof globalThis & {
  __hronautElementPicker?: { cancel?: unknown }
  __hronautScreenshotArea?: ScreenshotAreaControl
  __hronautAgentInputActive?: unknown
}

/**
 * Runs in the page: shades it and lets the person drag out an area to capture, resolving with the area, in viewport and
 * page coordinates, or with canceled for Esc, a cancelled pointer or a cancel call. It replaces a running element picker
 * or area picker, ignores input while an agent's input runs, takes native input from main, and asks again for an area
 * smaller than two pixels. Once it settles, its overlay is gone and two frames have passed, so the capture does not show it.
 */
export function screenshotAreaInPage(): Promise<ScreenshotAreaSelection> {
  return new Promise((resolve) => {
    const page = window as AreaPage
    const pickerKey = '__hronautScreenshotArea'
    const elementPicker = page.__hronautElementPicker
    if (elementPicker && typeof elementPicker.cancel === 'function') elementPicker.cancel()
    const previous = page[pickerKey]
    if (previous && typeof previous.cancel === 'function') previous.cancel()

    const shade = document.createElement('div')
    shade.setAttribute('data-hronaut-screenshot-area', 'shade')
    Object.assign(shade.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      pointerEvents: 'auto',
      background: 'rgba(8, 7, 20, 0.32)',
      cursor: 'crosshair'
    })
    const selection = document.createElement('div')
    selection.setAttribute('data-hronaut-screenshot-area', 'selection')
    Object.assign(selection.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      display: 'none',
      border: '2px solid #8c7cff',
      borderRadius: '3px',
      background: 'rgba(103, 87, 232, 0.08)',
      boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.92), 0 5px 22px rgba(0, 0, 0, 0.28)'
    })
    const hint = document.createElement('div')
    hint.setAttribute('data-hronaut-screenshot-area', 'hint')
    hint.textContent = 'Drag to capture an area  ·  Esc to cancel'
    Object.assign(hint.style, {
      position: 'fixed',
      zIndex: '2147483647',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
      padding: '7px 11px',
      borderRadius: '7px',
      color: '#fff',
      background: '#5747d6',
      boxShadow: '0 4px 18px rgba(0, 0, 0, 0.28)',
      font: '650 12px/1.35 system-ui, sans-serif',
      whiteSpace: 'nowrap'
    })
    const size = document.createElement('div')
    size.setAttribute('data-hronaut-screenshot-area', 'size')
    Object.assign(size.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      display: 'none',
      padding: '4px 7px',
      borderRadius: '5px',
      color: '#fff',
      background: '#17142d',
      font: '600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      whiteSpace: 'nowrap'
    })
    document.documentElement.append(shade, selection, hint, size)

    const previousCursor = document.documentElement.style.cursor
    document.documentElement.style.cursor = 'crosshair'
    let start: { x: number; y: number } | null = null
    let current: { x: number; y: number } | null = null
    let finished = false
    const point = (event: PointerEvent): { x: number; y: number } => ({
      x: Math.max(0, Math.min(innerWidth, event.clientX)),
      y: Math.max(0, Math.min(innerHeight, event.clientY))
    })
    const rectangle = (): AreaClip | null => {
      if (!start || !current) return null
      const left = Math.floor(Math.min(start.x, current.x))
      const top = Math.floor(Math.min(start.y, current.y))
      const right = Math.ceil(Math.max(start.x, current.x))
      const bottom = Math.ceil(Math.max(start.y, current.y))
      return { x: left, y: top, width: right - left, height: bottom - top }
    }
    const selectionResult = (): ScreenshotAreaSelection & { canceled: false } | null => {
      const clip = rectangle()
      if (!clip) return null
      return {
        canceled: false,
        clip,
        pageClip: { x: scrollX + clip.x, y: scrollY + clip.y, width: clip.width, height: clip.height },
        viewport: { width: innerWidth, height: innerHeight },
        url: location.href
      }
    }
    const draw = (): void => {
      const rect = rectangle()
      if (!rect) return
      shade.style.background = 'transparent'
      shade.style.boxShadow = 'none'
      selection.style.display = 'block'
      selection.style.left = rect.x + 'px'
      selection.style.top = rect.y + 'px'
      selection.style.width = rect.width + 'px'
      selection.style.height = rect.height + 'px'
      selection.style.boxShadow = '0 0 0 99999px rgba(8, 7, 20, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.92), 0 5px 22px rgba(0, 0, 0, 0.28)'
      size.style.display = 'block'
      size.textContent = rect.width + ' × ' + rect.height
      size.style.left = Math.max(6, Math.min(innerWidth - 92, rect.x)) + 'px'
      size.style.top = Math.max(6, rect.y >= 29 ? rect.y - 27 : Math.min(innerHeight - 25, rect.y + rect.height + 5)) + 'px'
    }
    const cleanup = (): void => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('pointercancel', onPointerCancel, true)
      shade.removeEventListener('lostpointercapture', onLostPointerCapture)
      document.removeEventListener('keydown', onKeyDown, true)
      document.documentElement.style.cursor = previousCursor
      shade.remove()
      selection.remove()
      hint.remove()
      size.remove()
      if (page[pickerKey]?.cancel === cancel) delete page[pickerKey]
    }
    const finish = (result: ScreenshotAreaSelection): void => {
      if (finished) return
      finished = true
      cleanup()
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)))
    }
    const cancel = (): void => finish({ canceled: true })
    const consume = (event: Event): void => {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const beginAt = (candidate: { x: number; y: number }): void => {
      start = candidate
      current = start
      draw()
    }
    const moveTo = (candidate: { x: number; y: number }): void => {
      if (!start) return
      current = candidate
      draw()
    }
    const completeAt = (candidate: { x: number; y: number }): boolean => {
      if (!start) return false
      current = candidate
      const result = selectionResult()
      if (!result || result.clip.width < 2 || result.clip.height < 2) {
        start = null
        current = null
        selection.style.display = 'none'
        size.style.display = 'none'
        shade.style.background = 'rgba(8, 7, 20, 0.32)'
        shade.style.boxShadow = 'none'
        hint.textContent = 'Drag a larger area  ·  Esc to cancel'
        return false
      }
      finish(result)
      return true
    }
    const nativeInput = (type: string, x: unknown, y: unknown): boolean => {
      if (finished) return false
      const candidate = {
        x: Math.max(0, Math.min(innerWidth, Number(x))),
        y: Math.max(0, Math.min(innerHeight, Number(y)))
      }
      if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return false
      if (type === 'down') beginAt(candidate)
      else if (type === 'move') moveTo(candidate)
      else if (type === 'up') return completeAt(candidate)
      return true
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 || page.__hronautAgentInputActive === true) return
      consume(event)
      beginAt(point(event))
      try { shade.setPointerCapture(event.pointerId) } catch { /* The pointer may already be gone. */ }
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (!start || page.__hronautAgentInputActive === true) return
      consume(event)
      if (event.pointerType === 'mouse' && event.buttons === 0) completeAt(point(event))
      else moveTo(point(event))
    }
    const onPointerUp = (event: PointerEvent): void => {
      if (!start || event.button !== 0 || page.__hronautAgentInputActive === true) return
      consume(event)
      completeAt(point(event))
    }
    const onLostPointerCapture = (): void => {
      if (finished || !start || !current) return
      const result = selectionResult()
      if (result && result.clip.width >= 2 && result.clip.height >= 2) finish(result)
    }
    const onPointerCancel = (event: PointerEvent): void => {
      if (!start) return
      consume(event)
      cancel()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      consume(event)
      cancel()
    }
    page[pickerKey] = { cancel, nativeInput }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointermove', onPointerMove, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('pointercancel', onPointerCancel, true)
    shade.addEventListener('lostpointercapture', onLostPointerCapture)
    document.addEventListener('keydown', onKeyDown, true)
  })
}

/** Runs in the page: hands a native pointer step to the running area picker, scaled from main's viewport to the page's. */
export function screenshotAreaNativeInputInPage(type: 'down' | 'move' | 'up', x: number, y: number, viewportWidth: number, viewportHeight: number): boolean {
  const picker = (window as AreaPage).__hronautScreenshotArea
  if (!picker || typeof picker.nativeInput !== 'function') return false
  const width = Math.max(1, viewportWidth)
  const height = Math.max(1, viewportHeight)
  return picker.nativeInput(
    type,
    x * innerWidth / width,
    y * innerHeight / height
  )
}

/** Runs in the page: cancels the running area picker; false when there is none. */
export function cancelScreenshotAreaInPage(): boolean {
  const picker = (window as AreaPage).__hronautScreenshotArea
  if (!picker || typeof picker.cancel !== 'function') return false
  picker.cancel()
  return true
}
