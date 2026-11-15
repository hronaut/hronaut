import { mount } from '@vue/test-utils'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OVERLAY_ENTRANCE_HOLD_MS,
  beginSurfaceLeave,
  holdOverlayEntrance,
  overlayEntranceEpoch,
  overlayExitHoldsPage,
  overlayTransitionHooks,
  releaseOverlayEntrance,
  resetOverlayMotion,
  setPageSnapshotOnScreen
} from '../../src/renderer/src/composables/overlay-motion.js'
import UiPopover from '../../src/renderer/src/ui/UiPopover.vue'
import UiOverlayTransition from '../../src/renderer/src/ui/UiOverlayTransition.vue'

const held = () => document.documentElement.hasAttribute('data-overlay-entrance-held')
const rendererRoot = join(process.cwd(), 'src/renderer/src')

afterEach(() => {
  resetOverlayMotion()
  vi.useRealTimers()
})

describe('overlay motion', () => {
  it('holds overlay entrances until the page views leave the screen, with a safety limit', () => {
    vi.useFakeTimers()
    holdOverlayEntrance()
    expect(held()).toBe(true)
    releaseOverlayEntrance()
    expect(held()).toBe(false)

    // Main reports when the pages leave the screen; this only caps a hold whose report never comes.
    expect(OVERLAY_ENTRANCE_HOLD_MS).toBe(1_000)
    holdOverlayEntrance()
    vi.advanceTimersByTime(OVERLAY_ENTRANCE_HOLD_MS - 1)
    expect(held()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(held()).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    // Each hold is a new entrance, so a late answer for an earlier one can be told apart.
    const epoch = overlayEntranceEpoch()
    holdOverlayEntrance()
    expect(overlayEntranceEpoch()).toBe(epoch + 1)
  })

  it('keeps the page hidden through each exit over the snapshot until it ends, is cancelled or overruns', () => {
    vi.useFakeTimers()
    setPageSnapshotOnScreen(true)
    const first = document.createElement('div')
    const second = document.createElement('div')
    overlayTransitionHooks.onBeforeLeave(first)
    overlayTransitionHooks.onBeforeLeave(second)
    // A leaving overlay takes no focus or input.
    expect(first.inert).toBe(true)
    expect(overlayExitHoldsPage.value).toBe(true)
    overlayTransitionHooks.onAfterLeave(first)
    expect(overlayExitHoldsPage.value).toBe(true)
    overlayTransitionHooks.onLeaveCancelled(second)
    expect(overlayExitHoldsPage.value).toBe(false)

    // An exit whose end is never reported, such as when its parent unmounts, cannot hide the page for good.
    overlayTransitionHooks.onBeforeLeave(first)
    vi.advanceTimersByTime(999)
    expect(overlayExitHoldsPage.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(overlayExitHoldsPage.value).toBe(false)
  })

  it('only keeps the page hidden behind a snapshot already on screen', () => {
    const exit = document.createElement('div')
    // A dialog closed while its snapshot was still decoding lets the page return at once.
    overlayTransitionHooks.onBeforeLeave(exit)
    expect(overlayExitHoldsPage.value).toBe(false)
    // The snapshot painting afterwards must not hide the returned page again.
    setPageSnapshotOnScreen(true)
    expect(overlayExitHoldsPage.value).toBe(false)
    overlayTransitionHooks.onAfterLeave(exit)

    // Main withdrawing the snapshot during an exit, such as for a tab picked in Search tabs, returns the page.
    overlayTransitionHooks.onBeforeLeave(exit)
    expect(overlayExitHoldsPage.value).toBe(true)
    setPageSnapshotOnScreen(false)
    expect(overlayExitHoldsPage.value).toBe(false)
  })

  it('ends at once the exit of a surface that never showed, and fades a half-shown one from where it got to', () => {
    setPageSnapshotOnScreen(true)
    const style = document.createElement('style')
    style.textContent = '.entering { opacity: 0.4; transform: scale(0.98); }'
    document.head.append(style)
    const surface = (playState: AnimationPlayState) => {
      const element = document.createElement('div')
      element.className = 'entering'
      element.append(Object.assign(document.createElement('section'), { className: 'entering' }))
      Object.assign(element, { getAnimations: () => [{ animationName: 'ui-surface-in', playState }] })
      document.body.append(element)
      return element
    }
    try {
      // Paused while it waited for the page snapshot: nothing showed, so nothing fades out.
      const held = surface('paused')
      overlayTransitionHooks.onBeforeLeave(held)
      expect(held.classList.contains('ui-overlay-leave-instant')).toBe(true)
      expect(held.inert).toBe(true)
      expect(overlayExitHoldsPage.value).toBe(false)

      // Half way in: the exit starts from the entrance's current look instead of full opacity.
      const entering = surface('running')
      overlayTransitionHooks.onBeforeLeave(entering)
      expect(entering.classList.contains('ui-overlay-leave-instant')).toBe(false)
      for (const element of [entering, entering.firstElementChild as HTMLElement]) {
        expect(element.style.opacity).toBe('0.4')
        expect(element.style.transform).toBe('scale(0.98)')
      }
      expect(overlayExitHoldsPage.value).toBe(true)

      const shown = surface('finished')
      expect(beginSurfaceLeave(shown)).toBe(false)
      expect(shown.style.opacity).toBe('')
    } finally {
      style.remove()
      document.querySelectorAll('.entering').forEach((element) => element.remove())
    }
  })

  it('keeps a closed overlay in place, inert, through its exit', async () => {
    setPageSnapshotOnScreen(true)
    const open = ref(true)
    const wrapper = mount(defineComponent({
      setup: () => () => h(UiOverlayTransition, null, () => open.value ? h('div', { class: 'settings-overlay' }) : null)
    }), { attachTo: document.body, global: { stubs: { transition: false } } })
    open.value = false
    await nextTick()
    const leaving = document.querySelector<HTMLElement>('.settings-overlay')
    expect(leaving?.classList.contains('ui-overlay-leave-active')).toBe(true)
    expect(leaving?.inert).toBe(true)
    expect(leaving?.getAttribute('aria-hidden')).toBe('true')
    expect(overlayExitHoldsPage.value).toBe(true)
    leaving?.dispatchEvent(new Event('animationend'))
    await vi.waitFor(() => expect(document.querySelector('.settings-overlay')).toBeNull())
    expect(overlayExitHoldsPage.value).toBe(false)
    wrapper.unmount()
  })

  it('lets a popover that covers the page hold it through its exit', async () => {
    setPageSnapshotOnScreen(true)
    const open = ref(true)
    const wrapper = mount(defineComponent({
      setup: () => () => h(UiPopover, { label: 'Agent access', holdsPage: true, modelValue: open.value }, () => 'Ready')
    }), { attachTo: document.body, global: { stubs: { transition: false } } })
    expect(document.querySelector('.ui-popover__panel')?.classList.contains('ui-popover__panel--holds-page')).toBe(true)
    open.value = false
    await nextTick()
    expect(overlayExitHoldsPage.value).toBe(true)
    document.querySelector('.ui-popover__panel')?.dispatchEvent(new Event('animationend'))
    await vi.waitFor(() => expect(document.querySelector('.ui-popover__panel')).toBeNull())
    expect(overlayExitHoldsPage.value).toBe(false)
    wrapper.unmount()
  })

  it('animates every full-window overlay with the motion tokens and holds its entrance with the page', () => {
    const motion = readFileSync(join(rendererRoot, 'styles/motion.css'), 'utf8')
    const rule = (selector: string) => motion.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\s*\\{([^}]*)\\}`, 'u'))?.[1] ?? ''
    expect(motion).toMatch(/@keyframes ui-surface-in \{ from \{ opacity: 0; transform: translateY\(var\(--motion-enter-y\)\) scale\(var\(--motion-enter-scale\)\); \} \}/u)
    expect(rule('.ui-menu__panel')).toContain('animation: ui-surface-in var(--motion-base) var(--motion-ease-spring) both;')
    // Main reserves page space from the Split view menu's measured box, which a transform would shrink.
    expect(rule('.split-view-menu')).toContain('animation: ui-backdrop-in var(--motion-base) var(--motion-ease-out) both;')
    expect(motion).toMatch(/\.wallet-approval-overlay,\n\.split-view-menu \{\n {2}animation: ui-backdrop-in var\(--motion-base\) var\(--motion-ease-out\) both;/u)
    expect(rule('.ui-overlay-leave-active')).toContain('animation: ui-backdrop-out var(--motion-fast) var(--motion-ease-out) both;')
    expect(rule('.ui-surface-leave-active')).toContain('animation: ui-surface-out var(--motion-fast) var(--motion-ease-out) both;')
    // A held entrance waits at its first frame, but an exit that starts meanwhile still plays.
    const heldRules = [...motion.matchAll(/:root\[data-overlay-entrance-held\] :is\(([^)]*)\):not\(\.ui-overlay-leave-active\)( > \*)?\s*[,{]/gu)]
    expect(heldRules.map((match) => match[2] ?? '')).toEqual(['', ' > *'])
    expect(motion).toMatch(/:root\[data-overlay-entrance-held\] \.ui-popover__panel--holds-page:not\(\.ui-surface-leave-active\) \{\n {2}animation-play-state: paused;/u)
    // A surface closed during its entrance leaves without jumping back to full opacity first.
    expect(motion).toMatch(/\.ui-overlay-leave-instant,\n\.ui-overlay-leave-instant > \* \{\n {2}animation: none !important;\n\}\n\n\.ui-overlay-leave-instant \{\n {2}opacity: 0 !important;\n\}\n$/u)
    for (const [, list] of heldRules) {
      for (const backdrop of ['.settings-overlay', '.tab-group-editor-overlay', '.wallet-approval-overlay']) expect(list).toContain(backdrop)
    }
    // Reduced motion stops every other animation with !important rules in the application layer. Motion's
    // layer comes first, so its own !important durations keep the same overlays animating, as fades.
    const animated = [...motion.matchAll(/^((?:[.:\w>* -]+,\n)*[.:\w>* -]+) \{\n {2}animation: ui-(?:backdrop|surface)-in /gmu)]
      .flatMap((match) => match[1].split(',').map((selector) => selector.trim()))
    expect(animated).toHaveLength(9)
    const reduced = motion.match(/@media \(prefers-reduced-motion: reduce\) \{\n {2}([^{]+)\{\n {4}animation-duration: var\(--motion-base\) !important;/u)?.[1] ?? ''
    expect(reduced.split(',').map((selector) => selector.trim()).sort()).toEqual(animated.sort())
    expect(motion).toMatch(/\.ui-surface-leave-active \{\n {4}animation-duration: var\(--motion-fast\) !important;/u)
    expect(readFileSync(join(rendererRoot, 'styles.css'), 'utf8')).toMatch(/@layer [^;]*primitives, motion, application,[^;]*;/u)
    const tokens = readFileSync(join(rendererRoot, 'styles/tokens.css'), 'utf8')
    expect(tokens).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[^}]*--motion-enter-y: 0px;[^}]*--motion-enter-scale: 1;/u)

    // Every component rendering a full-window backdrop plays its exit through the shared transition.
    const vueFiles = readdirSync(rendererRoot, { recursive: true, encoding: 'utf8' }).filter((name) => name.endsWith('.vue'))
    const backdrops = vueFiles.filter((name) => (
      /<div v-if="[^"]+" class="(?:settings-overlay|tab-group-editor-overlay|wallet-approval-overlay)\b/u.test(readFileSync(join(rendererRoot, name), 'utf8'))
    ))
    expect(backdrops.length).toBeGreaterThanOrEqual(8)
    expect(backdrops).toContain(join('features', 'wallets', 'WalletApprovalDialog.vue'))
    for (const name of backdrops) {
      expect(readFileSync(join(rendererRoot, name), 'utf8'), name).toMatch(/<template>\n {2}<UiOverlayTransition>\n/u)
    }
  })
})
