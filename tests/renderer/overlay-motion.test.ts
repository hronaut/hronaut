import { mount } from '@vue/test-utils'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OVERLAY_ENTRANCE_HOLD_MS,
  holdOverlayEntrance,
  overlayTransitionHooks,
  overlaysLeaving,
  releaseOverlayEntrance,
  resetOverlayMotion
} from '../../src/renderer/src/composables/overlay-motion.js'
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
  })

  it('counts each leaving overlay until its exit ends, is cancelled or overruns', () => {
    vi.useFakeTimers()
    const first = document.createElement('div')
    const second = document.createElement('div')
    overlayTransitionHooks.onBeforeLeave(first)
    overlayTransitionHooks.onBeforeLeave(second)
    // A leaving overlay takes no focus or input.
    expect(first.inert).toBe(true)
    expect(overlaysLeaving.value).toBe(true)
    overlayTransitionHooks.onAfterLeave(first)
    expect(overlaysLeaving.value).toBe(true)
    overlayTransitionHooks.onLeaveCancelled(second)
    expect(overlaysLeaving.value).toBe(false)

    // An exit whose end is never reported, such as when its parent unmounts, cannot hide the page for good.
    overlayTransitionHooks.onBeforeLeave(first)
    vi.advanceTimersByTime(999)
    expect(overlaysLeaving.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(overlaysLeaving.value).toBe(false)
  })

  it('keeps a closed overlay in place, inert, through its exit', async () => {
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
    expect(overlaysLeaving.value).toBe(true)
    leaving?.dispatchEvent(new Event('animationend'))
    await vi.waitFor(() => expect(document.querySelector('.settings-overlay')).toBeNull())
    expect(overlaysLeaving.value).toBe(false)
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
    const components = join(rendererRoot, 'components')
    const backdrops = readdirSync(components).filter((name) => name.endsWith('.vue')).filter((name) => (
      /<div v-if="[^"]+" class="(?:settings-overlay|tab-group-editor-overlay|wallet-approval-overlay)\b/u.test(readFileSync(join(components, name), 'utf8'))
    ))
    expect(backdrops.length).toBeGreaterThanOrEqual(8)
    for (const name of backdrops) {
      expect(readFileSync(join(components, name), 'utf8'), name).toMatch(/<template>\n {2}<UiOverlayTransition>\n/u)
    }
  })
})
