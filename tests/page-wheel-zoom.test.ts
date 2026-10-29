import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'
import { attachPageWheelZoom } from '../src/main/browser/page-zoom/page-wheel-zoom.js'

// The state publication a zoom ends with, recorded on the fake browser it publishes for.
vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({
  browserState: () => ({}),
  publishChange: (browser: { changed(persist: boolean): void }, persist: boolean) => { browser.changed(persist) }
}))

type ZoomTab = Pick<BrowserTab, 'id' | 'url' | 'webContents' | 'nativeInputEnvironmentGeneration'>

/** What the browser around the page says; each case below changes one thing. */
interface ZoomState {
  occluded?: boolean
  locked?: boolean
  agentInput?: boolean
  selecting?: boolean
  closed?: boolean
}

function page(): WebContents & EventEmitter {
  let factor = 1
  return Object.assign(new EventEmitter(), {
    id: 41,
    isDestroyed: () => false,
    getZoomFactor: () => factor,
    setZoomFactor: (next: number) => { factor = next }
  }) as unknown as WebContents & EventEmitter
}

function attached(url: string, state: ZoomState = {}) {
  const webContents = page()
  const tab: ZoomTab = { id: 'tab', url, webContents, nativeInputEnvironmentGeneration: 0 }
  const changed = vi.fn()
  const browser = {
    tabs: new Map(state.closed ? [] : [[tab.id, tab]]),
    browserContentOccluded: state.occluded === true,
    isHumanInteractionLocked: () => state.locked === true,
    agentInputWebContents: new Map(state.agentInput ? [[41, 1]] : []),
    screenshotAreaSessions: new Map(state.selecting ? [[41, {}]] : []),
    elementPickerSessions: new Map(),
    // The state publication the zoom ends with, as the zoom bar and Ctrl/Cmd with + or - publish it.
    changed
  } as unknown as Browser
  attachPageWheelZoom(browser, tab as BrowserTab, webContents)
  const turn = (direction: 'in' | 'out') => { webContents.emit('zoom-changed', {}, direction) }
  return { tab, webContents, changed, turn, percent: () => Math.round(webContents.getZoomFactor() * 100) }
}

describe('Control with the mouse wheel', () => {
  it('zooms a website one step for each notch, as Ctrl/Cmd with + or - does', () => {
    // Electron reports the zoom Chromium asks for and leaves it to the app, so the page stayed at 100%.
    const { turn, percent, changed, tab } = attached('https://maps.example/')
    turn('in')
    expect(percent()).toBe(110)
    turn('in')
    expect(percent()).toBe(125)
    turn('out')
    turn('out')
    turn('out')
    expect(percent()).toBe(90)
    expect(changed).toHaveBeenCalledWith(false)
    expect(tab.nativeInputEnvironmentGeneration).toBe(5)
  })

  it('keeps Hronaut Home at its own size', () => {
    const { turn, percent } = attached('hronaut://home/')
    turn('in')
    expect(percent()).toBe(100)
  })

  it.each([
    ['behind trusted chrome', { occluded: true }],
    ['while the tab is locked', { locked: true }],
    ['while an agent sends input to the page', { agentInput: true }],
    ['during an area capture or element pick on the page', { selecting: true }],
    ['after the tab closed', { closed: true }]
  ])('leaves the zoom alone %s', (_case, state: ZoomState) => {
    const { turn, percent } = attached('https://maps.example/', state)
    turn('in')
    expect(percent()).toBe(100)
  })

  it('leaves the zoom alone for a page the tab no longer shows', () => {
    const { turn, percent, tab } = attached('https://maps.example/')
    tab.webContents = page()
    turn('in')
    expect(percent()).toBe(100)
    expect(tab.webContents.getZoomFactor()).toBe(1)
  })
})
