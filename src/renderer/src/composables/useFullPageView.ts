import { computed, ref, shallowRef, type Ref } from 'vue'
import { useTabRailInteractionController } from './useTabRailInteractionController.js'

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
  // The rail's own reveal timing: shown after a short hover, kept while focused, pointer-held or dragging,
  // and hidden again when the window loses focus, as when the person clicks the page.
  const edge = useTabRailInteractionController({ enabled: active, onNativeBlur: () => undefined })
  const holds = shallowRef<ReadonlyArray<() => boolean>>([])
  const concealed = computed(() => active.value && !edge.revealed.value && !options.attention.value
    && !holds.value.some((held) => held()))

  /** Keeps the chrome in view while the source is true, such as a menu or card anchored to it. */
  function holdWhile(source: () => boolean): void {
    holds.value = [...holds.value, source]
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
