import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { attachPageTargetUrlEvents } from '../src/main/browser/tab-events/page-target-url-events.js'
import type { Browser } from '../src/main/browser/browser.js'

// Pointing at a link showed nothing of where it goes. Chrome shows its address in the status bubble; an agent's
// pointing says nothing of where the person points, and nothing of an agent's is drawn over the page.

function fixture() {
  const page = Object.assign(new EventEmitter(), { id: 7 }) as EventEmitter & WebContents
  const agentInput = new Map<number, number>()
  const toolCalls = new Set<string>()
  const options = { onPageTargetUrl: vi.fn(), onPagePointer: vi.fn() }
  const browser = { agentInputWebContents: agentInput, mcpActivitiesByTab: toolCalls, options } as unknown as Browser
  attachPageTargetUrlEvents(browser, { id: 'tab' }, page)
  const mouse = (type: string, x = 0, y = 0) => page.emit('before-mouse-event', {}, { type, x, y })
  return { page, agentInput, toolCalls, options, mouse, link: (url: string) => page.emit('update-target-url', {}, url) }
}

describe('the links a page reports for the status bubble', () => {
  it('passes on the link the person points at or focuses, and where the pointer is over the page', () => {
    const h = fixture()
    h.mouse('mouseEnter', 10, 20)
    h.mouse('mouseMove', 12.5, 21)
    h.link('https://example.com/docs')
    h.page.emit('before-input-event', {}, { type: 'keyDown', key: 'Tab' })
    h.link('https://example.com/next')
    h.mouse('mouseDown', 12.5, 21)
    h.mouse('mouseLeave', 0, 0)
    h.link('')
    expect(h.options.onPagePointer.mock.calls).toEqual([['tab', { x: 10, y: 20 }], ['tab', { x: 12.5, y: 21 }], ['tab', null]])
    expect(h.options.onPageTargetUrl.mock.calls).toEqual([['tab', 'https://example.com/docs'], ['tab', 'https://example.com/next'], ['tab', '']])
  })

  it('takes the bubble away for an agent\'s input, and shows nothing until the person\'s own', () => {
    const h = fixture()
    h.link('https://example.com/person')
    h.agentInput.set(7, 1)
    h.mouse('mouseMove', 300, 400)
    h.link('https://example.com/agent')
    expect(h.options.onPageTargetUrl.mock.calls).toEqual([['tab', 'https://example.com/person'], ['tab', '']])
    expect(h.options.onPagePointer).not.toHaveBeenCalled()
    // An agent's input through the debugger reaches no input event: its link is dropped as well.
    h.agentInput.clear()
    h.link('')
    h.agentInput.set(7, 1)
    h.link('https://example.com/debugger')
    // Its last link stays reported under the pointer after its input ends, until the person moves or types.
    h.agentInput.clear()
    h.link('https://example.com/after')
    expect(h.options.onPageTargetUrl.mock.calls).toEqual([['tab', 'https://example.com/person'], ['tab', '']])
    h.mouse('mouseMove', 50, 60)
    h.link('https://example.com/person-again')
    expect(h.options.onPageTargetUrl).toHaveBeenLastCalledWith('tab', 'https://example.com/person-again')
    expect(h.options.onPagePointer).toHaveBeenLastCalledWith('tab', { x: 50, y: 60 })
    h.agentInput.set(7, 1)
    h.page.emit('before-input-event', {}, { type: 'keyDown', key: 'Tab' })
    h.agentInput.clear()
    h.link('https://example.com/agent-focus')
    h.page.emit('before-input-event', {}, { type: 'keyDown', key: 'Tab' })
    h.link('https://example.com/person-focus')
    expect(h.options.onPageTargetUrl.mock.calls.slice(-2)).toEqual([['tab', ''], ['tab', 'https://example.com/person-focus']])
  })

  it('takes the bubble away for a link reported during an agent\'s tool call, such as a script that focuses one', () => {
    const h = fixture()
    h.link('https://example.com/person')
    h.toolCalls.add('tab')
    h.link('https://example.com/focused-by-script')
    expect(h.options.onPageTargetUrl.mock.calls).toEqual([['tab', 'https://example.com/person'], ['tab', '']])
    // The person's pointer still moves the bubble out of its way meanwhile, but whose link it is cannot be told.
    h.mouse('mouseMove', 20, 30)
    expect(h.options.onPagePointer).toHaveBeenLastCalledWith('tab', { x: 20, y: 30 })
    h.link('https://example.com/during-the-call')
    expect(h.options.onPageTargetUrl).toHaveBeenCalledTimes(3)
    expect(h.options.onPageTargetUrl).toHaveBeenLastCalledWith('tab', '')
    h.toolCalls.clear()
    h.link('https://example.com/after-the-call')
    expect(h.options.onPageTargetUrl).toHaveBeenCalledTimes(3)
    h.mouse('mouseMove', 22, 30)
    h.link('https://example.com/person-again')
    expect(h.options.onPageTargetUrl).toHaveBeenLastCalledWith('tab', 'https://example.com/person-again')
  })

  it('takes the bubble away with the page', () => {
    const h = fixture()
    h.link('https://example.com/docs')
    h.page.emit('destroyed')
    expect(h.options.onPageTargetUrl).toHaveBeenLastCalledWith('tab', '')
  })
})
