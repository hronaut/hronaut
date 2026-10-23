import { onScopeDispose, watch, type Ref } from 'vue'
import type {
  HronautSidebarOverlayApi,
  SidebarOverlayIntent,
  SidebarOverlayModel,
  SidebarOverlayPointer
} from '../../../shared/sidebar-overlay.js'

export interface SidebarOverlayOptions {
  /** Main's channel for the open rail over the page; without it the rail opens beside the page. */
  api: HronautSidebarOverlayApi | undefined
  /** The rail is open and shows over the page now, rather than in the shell. */
  overlaid: Readonly<Ref<boolean>>
  /** What the open rail shows; read again whenever what it reads changes. Null when it cannot be sent. */
  model: () => SidebarOverlayModel | null
  /** Main's view shows the rail, so the pointer is there, or stopped showing it while the rail stays open. */
  delegate: (active: boolean) => void
  pointer: (pointer: SidebarOverlayPointer) => void
  /** Main cannot show this opening of the rail; the shell opens its own beside the page. */
  refused: () => void
  /** Main took the rail down by itself, as when the window lost focus. */
  hidden: () => void
  /** What the person did in the rail over the page, which the shell runs as a click in its own rail. */
  intent: (intent: SidebarOverlayIntent) => void
}

/**
 * Opens the tab rail over the page in main's view while the shell's own rail stays folded beside it. Each opening is
 * one request with an id of its own; what the rail shows meanwhile updates it, and main answers with what happens to
 * it. The shell's interaction controller still decides when the rail opens and closes.
 */
export function useSidebarOverlay(options: SidebarOverlayOptions): { readonly shownId: number | undefined } {
  const api = options.api
  let nextId = 0
  let session: { id: number; shown: boolean; sent: string } | null = null

  function readModel(): SidebarOverlayModel | null {
    try {
      return options.model()
    } catch (error) {
      console.error('[sidebar overlay] Could not describe the open rail:', error)
      return null
    }
  }

  function start(): void {
    const model = readModel()
    if (!api || !model) {
      options.refused()
      return
    }
    // Only plain data crosses to main; the shell's state is reactive.
    const sent = JSON.stringify(model)
    session = { id: ++nextId, shown: false, sent }
    options.delegate(true)
    api.show({ id: session.id, model: JSON.parse(sent) as SidebarOverlayModel })
  }

  function stop(): void {
    const current = session
    if (!current) return
    session = null
    api?.hide(current.id)
    options.delegate(false)
  }

  const stopOverlaid = watch(options.overlaid, (overlaid) => {
    if (overlaid && !session) start()
    else if (!overlaid) stop()
  }, { immediate: true, flush: 'sync' })

  // What the rail shows changes while it is open: a tab loads, an agent starts working, the window resizes.
  const stopModel = watch(() => (options.overlaid.value && session ? readModel() : undefined), (model) => {
    const current = session
    if (!api || !current || model === undefined) return
    if (!model) {
      stop()
      options.refused()
      return
    }
    const sent = JSON.stringify(model)
    if (sent === current.sent) return
    current.sent = sent
    api.show({ id: current.id, model: JSON.parse(sent) as SidebarOverlayModel })
  })

  const stopEvents = api?.onEvent((event) => {
    const current = session
    if (!current || event.id !== current.id) return
    switch (event.kind) {
      case 'shown':
        current.shown = true
        return
      case 'unavailable':
        session = null
        options.delegate(false)
        options.refused()
        return
      case 'hidden':
        session = null
        options.hidden()
        return
      case 'pointer':
        options.pointer({ hovered: event.hovered, held: event.held })
        return
      case 'intent':
        options.intent(event.intent)
    }
  })

  // Escape closes the rail over the page while the shell has the keyboard; the view does the same while it has it.
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !session?.shown || event.defaultPrevented) return
    options.intent({ kind: 'dismiss' })
  }
  window.addEventListener('keydown', onKeyDown)

  onScopeDispose(() => {
    stopOverlaid()
    stopModel()
    stopEvents?.()
    window.removeEventListener('keydown', onKeyDown)
    stop()
  })

  return {
    get shownId() {
      return session?.shown ? session.id : undefined
    }
  }
}
