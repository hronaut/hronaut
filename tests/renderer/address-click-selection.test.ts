import { fireEvent, render, screen } from '@testing-library/vue'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useAddressClickSelection } from '../../src/renderer/src/features/address-bar/address-click-selection.js'

// A click in the address bar put the caret where it landed, so typing a new address went into the middle of the old
// one. Chrome's address bar selects all of its text on the click that gives it the keyboard.

afterEach(() => vi.restoreAllMocks())

const ADDRESS = 'https://example.test/docs/start'

async function field(): Promise<HTMLInputElement> {
  const Harness = defineComponent({
    setup() {
      const input = ref<HTMLInputElement | null>(null)
      useAddressClickSelection(input)
      return () => h('div', [h('input', { ref: input, 'aria-label': 'Address', value: ADDRESS }), h('button', 'Elsewhere')])
    }
  })
  render(Harness)
  // The field's listeners attach once it is in the document.
  await nextTick()
  return screen.getByRole<HTMLInputElement>('textbox', { name: 'Address' })
}

/** A press on the field, which gives it the keyboard as a press does, and puts the caret or a drag's selection there. */
async function press(input: HTMLInputElement, button: number, start: number, end = start): Promise<void> {
  await fireEvent.mouseDown(input, { button })
  input.focus()
  input.setSelectionRange(start, end)
}

const selection = (input: HTMLInputElement) => [input.selectionStart, input.selectionEnd, input.selectionDirection]

it('selects the whole address on the click that gives the field the keyboard, and places the caret on the next', async () => {
  const input = await field()
  await press(input, 0, 8)
  await fireEvent.mouseUp(input, { button: 0 })
  expect(selection(input)).toEqual([0, ADDRESS.length, 'backward'])

  await press(input, 0, 8)
  await fireEvent.mouseUp(input, { button: 0 })
  expect(selection(input)).toEqual([8, 8, 'none'])
})

it('keeps the part a drag selected', async () => {
  const input = await field()
  await press(input, 0, 8, 15)
  await fireEvent.mouseUp(input, { button: 0 })
  expect(selection(input)).toEqual([8, 15, 'none'])
})

it('selects the whole address before the menu of a right click reads it, not for a middle click', async () => {
  const input = await field()
  await press(input, 2, 8)
  await fireEvent.contextMenu(input)
  expect(selection(input)).toEqual([0, ADDRESS.length, 'backward'])
  await fireEvent.mouseUp(input, { button: 2 })
  expect(selection(input)).toEqual([0, ADDRESS.length, 'backward'])

  screen.getByRole('button', { name: 'Elsewhere' }).focus()
  await press(input, 1, 8)
  await fireEvent.mouseUp(input, { button: 1 })
  expect(selection(input)).toEqual([8, 8, 'none'])
})

// The page in the tab is another document. When it takes the keyboard, Electron blurs the field while the shell's
// document no longer has focus, and the field stays its focused element. The e2e tests cannot see this: Playwright's
// focus emulation keeps the shell focused.
it('selects the whole address when the page had the keyboard, unless the field has it again since', async () => {
  const input = await field()
  input.focus()
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  await fireEvent.blur(input)
  hasFocus.mockReturnValue(true)
  await fireEvent.focus(input)
  await press(input, 0, 8)
  await fireEvent.mouseUp(input, { button: 0 })
  expect(selection(input)).toEqual([0, ADDRESS.length, 'backward'])

  // Back from another window with the keyboard still in the field, typing in it, then clicking in it.
  hasFocus.mockReturnValue(false)
  await fireEvent.blur(input)
  hasFocus.mockReturnValue(true)
  await fireEvent.focus(input)
  await fireEvent.keyDown(input, { key: 'ArrowLeft' })
  await press(input, 0, 8)
  await fireEvent.mouseUp(input, { button: 0 })
  expect(selection(input)).toEqual([8, 8, 'none'])
})
