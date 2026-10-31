import { fireEvent, render, screen } from '@testing-library/vue'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAddressClickSelection } from '../../src/renderer/src/features/address-bar/useAddressClickSelection.js'

// A click in the address bar put the caret where it landed, so typing a new address went into the middle of the old
// one. Chrome's address bar selects all of its text on the click that gives it the keyboard.

// An event's time stamp is the clock's time when it is made. A press reports when it happened, which is before the
// window gives the keyboard to the field for it.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

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

const elsewhere = () => screen.getByRole('button', { name: 'Elsewhere' }).focus()
const selection = (input: HTMLInputElement) => [input.selectionStart, input.selectionEnd, input.selectionDirection]
const all = [0, ADDRESS.length, 'backward']

/** A press at this time and place, which gives the field the keyboard, and puts the caret or a selection there. */
function press(input: HTMLInputElement, at: number, init: MouseEventInit, caret?: [number, number]): void {
  vi.setSystemTime(at)
  input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init }))
  input.focus()
  if (caret) input.setSelectionRange(...caret)
}

/** Releases the button; whether the field kept Chromium from placing the caret where the press landed. */
function release(input: HTMLInputElement, init: MouseEventInit): boolean {
  const event = new MouseEvent('mouseup', { bubbles: true, cancelable: true, ...init })
  input.dispatchEvent(event)
  return event.defaultPrevented
}

it('selects the whole address on the click that gives the field the keyboard, and places the caret on the next', async () => {
  const input = await field()
  press(input, 1_000, { button: 0, clientX: 40 }, [8, 8])
  expect(release(input, { button: 0, clientX: 40 })).toBe(true)
  expect(selection(input)).toEqual(all)

  press(input, 2_000, { button: 0, clientX: 40 }, [8, 8])
  expect(release(input, { button: 0, clientX: 40 })).toBe(false)
  expect(selection(input)).toEqual([8, 8, 'none'])
})

it('keeps what a drag selected, and selects the whole address after a press that only wobbled', async () => {
  const input = await field()
  press(input, 1_000, { button: 0, clientX: 40 }, [8, 15])
  expect(release(input, { button: 0, clientX: 90 })).toBe(false)
  expect(selection(input)).toEqual([8, 15, 'none'])

  elsewhere()
  press(input, 2_000, { button: 0, clientX: 40, clientY: 10 }, [8, 9])
  expect(release(input, { button: 0, clientX: 42, clientY: 12 })).toBe(true)
  expect(selection(input)).toEqual(all)
})

// The page in the tab is another document. When it takes the keyboard, the field stays the shell's focused element with
// its selection, and has the keyboard again when a click on it gives the window back the keyboard, before or after the
// press reaches it. The e2e tests cannot see this: Playwright's focus emulation keeps the shell focused.
it('selects the whole address when the page had the keyboard, also with a press inside the field\'s earlier selection', async () => {
  const input = await field()
  input.focus()
  input.select()
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  await fireEvent.blur(input)

  // The keyboard comes back first, then the press, which happened before it.
  vi.setSystemTime(3_000)
  const early = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 40 })
  vi.setSystemTime(3_010)
  hasFocus.mockReturnValue(true)
  await fireEvent.focus(input)
  input.dispatchEvent(early)
  // Chromium leaves a selection a press lands in until the release, and then puts the caret there.
  expect(release(input, { button: 0, clientX: 40 })).toBe(true)
  expect(selection(input)).toEqual(all)

  // The press first, then the keyboard.
  hasFocus.mockReturnValue(false)
  await fireEvent.blur(input)
  press(input, 4_000, { button: 0, clientX: 40 }, [8, 8])
  hasFocus.mockReturnValue(true)
  await fireEvent.focus(input)
  expect(release(input, { button: 0, clientX: 40 })).toBe(true)
  expect(selection(input)).toEqual(all)
})

it('places the caret when the field had the keyboard since before the press, as after coming back to the window', async () => {
  const input = await field()
  input.focus()
  const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  await fireEvent.blur(input)
  vi.setSystemTime(5_000)
  hasFocus.mockReturnValue(true)
  await fireEvent.focus(input)
  press(input, 6_000, { button: 0, clientX: 40 }, [8, 8])
  expect(release(input, { button: 0, clientX: 40 })).toBe(false)
  expect(selection(input)).toEqual([8, 8, 'none'])
})

it('selects the whole address before the menu of a right click reads it, also over a word macOS selected', async () => {
  const input = await field()
  press(input, 1_000, { button: 2, clientX: 40 }, [8, 13])
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
  input.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(false)
  expect(selection(input)).toEqual(all)
  release(input, { button: 2, clientX: 40 })
  expect(selection(input)).toEqual(all)

  // Windows releases the button before the menu opens.
  elsewhere()
  press(input, 2_000, { button: 2, clientX: 40 }, [8, 8])
  expect(release(input, { button: 2, clientX: 40 })).toBe(true)
  expect(selection(input)).toEqual(all)
})

it('leaves a middle click and a press with a key in between alone', async () => {
  const input = await field()
  press(input, 1_000, { button: 1, clientX: 40 }, [8, 8])
  expect(release(input, { button: 1, clientX: 40 })).toBe(false)
  expect(selection(input)).toEqual([8, 8, 'none'])

  elsewhere()
  press(input, 2_000, { button: 0, clientX: 40 }, [8, 8])
  await fireEvent.keyDown(input, { key: 'ContextMenu' })
  input.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  expect(release(input, { button: 0, clientX: 40 })).toBe(false)
  expect(selection(input)).toEqual([8, 8, 'none'])
})
