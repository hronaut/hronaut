import { defineComponent, nextTick, ref } from 'vue'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useModalDialogFocus } from '../../src/renderer/src/composables/useModalDialogFocus.js'

const ModalHandoffHarness = defineComponent({
  setup() {
    const firstOpen = ref(false)
    const secondOpen = ref(false)
    const firstPanel = ref<HTMLElement | null>(null)
    const secondPanel = ref<HTMLElement | null>(null)
    useModalDialogFocus({ open: firstOpen, panel: firstPanel })
    useModalDialogFocus({ open: secondOpen, panel: secondPanel })

    function openFirst(): void {
      firstOpen.value = true
    }

    function handoff(): void {
      firstOpen.value = false
      secondOpen.value = true
    }

    function closeSecond(): void {
      secondOpen.value = false
    }

    return { firstOpen, secondOpen, firstPanel, secondPanel, openFirst, handoff, closeSecond }
  },
  template: `
    <button type="button" @click="openFirst">Open first</button>
    <section v-if="firstOpen" ref="firstPanel" role="dialog" aria-modal="true" aria-label="First" tabindex="-1">
      <button type="button" @click="handoff">Open second</button>
    </section>
    <section v-if="secondOpen" ref="secondPanel" role="dialog" aria-modal="true" aria-label="Second" tabindex="-1">
      <button type="button" @click="closeSecond">Close second</button>
    </section>
  `
})

const ModalTrapHarness = defineComponent({
  setup() {
    const open = ref(false)
    const panel = ref<HTMLElement | null>(null)
    useModalDialogFocus({ open, panel })
    return { open, panel }
  },
  template: `
    <button type="button" @click="open = true">Open dialog</button>
    <button type="button">Background action</button>
    <section v-if="open" ref="panel" role="dialog" aria-modal="true" aria-label="Focus trap" tabindex="-1">
      <button type="button">First action</button>
      <button type="button" disabled>Disabled action</button>
      <button type="button">Last action</button>
    </section>
  `
})

describe('modal dialog focus lifecycle', () => {
  it('wraps keyboard focus inside the active modal and redirects escaped focus', async () => {
    const user = userEvent.setup()
    render(ModalTrapHarness)
    await user.click(screen.getByRole('button', { name: 'Open dialog' }))
    const dialog = await screen.findByRole('dialog', { name: 'Focus trap' })
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Last action' })
    const background = screen.getByRole('button', { name: 'Background action' })

    await nextTick()
    expect(dialog).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()
    background.focus()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('preserves the original focus target across a modal handoff', async () => {
    const user = userEvent.setup()
    render(ModalHandoffHarness)
    const trigger = screen.getByRole('button', { name: 'Open first' })

    await user.click(trigger)
    const first = await screen.findByRole('dialog', { name: 'First' })
    await nextTick()
    expect(first).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Open second' }))
    const second = await screen.findByRole('dialog', { name: 'Second' })
    await nextTick()
    expect(second).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Close second' }))
    await nextTick()
    expect(trigger).toHaveFocus()
  })
})
