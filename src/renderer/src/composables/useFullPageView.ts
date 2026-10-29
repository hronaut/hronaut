import { computed, getCurrentScope, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue'
import { useTabRailInteractionController } from '../features/tabs/useTabRailInteractionController.js'

// A click on the page takes focus from the shell when the button goes down. The chrome stays this long after,
// so the page does not move between the press and the release.
const CLICK_SETTLE_DELAY = 400

export interface FullPageViewOptions {
  /** A website is in view in the main window, so there is a page to give the window to. */
  available: Readonly<Ref<boolean>>
  /** An agent needs the person, so the chrome comes back to show who and why. */
  attention: Readonly<Ref<boolean>>
}

/**
 * The full-page view hides the tabs, the rail and the toolbar so the page fills the window. They come back
 * while the pointer rests at the window's top edge (or its left edge with the rail), while they hold keyboard
 * focus, while something opened from them is open, and while an agent needs the person. It lasts for this
 * launch only.
 */
export function useFullPageView(options: FullPageViewOptions) {
  const enabled = ref(false)
  const active = computed(() => enabled.value && options.available.value)
  // A click on the page hides shown chrome only once the click is done.
  const settling = ref(false)
  let settleTimer: number | undefined
  function settle(wasRevealed: boolean): void {
    if (!wasRevealed || !active.value) return
    window.clearTimeout(settleTimer)
    settling.value = true
    settleTimer = window.setTimeout(() => { settleTimer = undefined; settling.value = false }, CLICK_SETTLE_DELAY)
  }
  function stopSettling(): void {
    window.clearTimeout(settleTimer)
    settleTimer = undefined
    settling.value = false
  }
  // The rail's own reveal timing: shown after a short hover, kept while focused, pointer-held or dragging,
  // and hidden again when the window loses focus, as when the person clicks the page.
  const edge = useTabRailInteractionController({ enabled: active, onNativeBlur: settle })
  watch(active, (on) => { if (!on) stopSettling() }, { flush: 'sync' })
  onScopeDispose(stopSettling)
  const holds = shallowRef<ReadonlyArray<() => boolean>>([])
  const concealed = computed(() => active.value && !edge.revealed.value && !settling.value && !options.attention.value
    && !holds.value.some((held) => held()))

  /** Keeps the chrome in view while the source is true, such as a menu or card anchored to it. Returns a function that ends the hold. */
  function holdWhile(source: () => boolean): () => void {
    holds.value = [...holds.value, source]
    const release = (): void => { holds.value = holds.value.filter((held) => held !== source) }
    // A hold registered from a component's setup ends with that component.
    if (getCurrentScope()) onScopeDispose(release)
    return release
  }

  /** Turns the view on over a website, or off anywhere. Returns whether it changed. */
  function toggle(): boolean {
    if (!enabled.value && !options.available.value) return false
    enabled.value = !enabled.value
    return true
  }

  return {
    enabled,
    active,
    concealed,
    reveal: edge.reveal,
    conceal: edge.conceal,
    focusOut: edge.focusOut,
    sync: edge.sync,
    holdWhile,
    toggle
  }
}

export type FullPageView = ReturnType<typeof useFullPageView>
