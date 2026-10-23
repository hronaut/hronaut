import { describe, expect, it, vi } from 'vitest'
import type { IpcMainEvent } from 'electron'
import {
  SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET,
  SidebarOverlay,
  sidebarOverlayBounds,
  type SidebarOverlayLayout,
  type SidebarOverlayMenu,
  type SidebarOverlaySurface
} from '../src/main/sidebar-overlay.js'
import { registerOverlayViewsIpc } from '../src/main/overlay-views-ipc.js'
import {
  parseSidebarOverlayIntent,
  parseSidebarOverlayPointer,
  parseSidebarOverlayRendered,
  parseSidebarOverlayRequest,
  sidebarOverlayRequestId,
  type SidebarOverlayEvent,
  type SidebarOverlayModel,
  type SidebarOverlayState,
  type SidebarOverlayTab
} from '../src/shared/sidebar-overlay.js'

function tab(id: string, overrides: Partial<SidebarOverlayTab> = {}): SidebarOverlayTab {
  return {
    id,
    title: `Tab ${id}`,
    url: `https://${id}.example/`,
    active: false,
    pinned: false,
    loading: false,
    sleeping: false,
    humanInteractionLocked: false,
    audible: false,
    muted: false,
    pageProblem: false,
    emulation: false,
    emulationDescription: '',
    networkConditionUnconfirmed: false,
    videoRecording: false,
    pwaLifecycleActive: false,
    tooltip: `Tab ${id}`,
    ...overrides
  }
}

function model(overrides: Partial<SidebarOverlayModel> = {}): SidebarOverlayModel {
  return {
    theme: 'dark',
    locale: 'en-US',
    platform: 'linux',
    width: 280,
    top: 48,
    viewport: { width: 1200, height: 800 },
    tint: null,
    rail: {
      tabs: [tab('alpha', { active: true }), tab('beta', { mcpGroupId: 'research' })],
      workspaces: [{ id: 'research', name: 'Research', description: '', color: 'blue' }],
      activeTabId: 'alpha',
      allHumanInteractionLocked: false,
      allTabsMuted: false,
      settingsActive: false,
      workspaceSwitcherOpen: false,
      collapsedWorkspaceIds: [],
      agents: {},
      scrollTop: 0
    },
    footer: {
      commandPaletteOpen: false,
      tabSearchOpen: false,
      downloadsOpen: false,
      historyOpen: false,
      settingsOpen: false,
      downloadCount: 0,
      activeDownloadCount: 0,
      lastDownloadDone: false,
      downloadButtonLabel: 'Downloads',
      hasWebsiteTabs: true,
      allTabsMuted: false,
      allInteractionLocked: false,
      allInteractionLockLabel: 'Lock all tabs',
      interactionPending: false,
      audioPending: false,
      followAgentActivity: false,
      licenseReminderShown: false,
      mcp: { endpoint: 'http://127.0.0.1:7777/mcp', state: { status: 'ready', paused: false }, pauseBusy: false }
    },
    ...overrides
  }
}

describe('sidebar overlay contracts', () => {
  it('accepts an open rail within the shell limits and refuses anything else', () => {
    const request = { id: 3, model: model() }
    expect(parseSidebarOverlayRequest(request)).toEqual(request)
    expect(parseSidebarOverlayRequest({ id: 4, model: model({ tint: '#1A2B3C' }) }).model.tint).toBe('#1A2B3C')
    const rail = model().rail
    const bad: unknown[] = [
      null,
      { id: 0, model: model() },
      { id: 1.5, model: model() },
      { id: 1, model: { ...model(), theme: 'system' } },
      { id: 1, model: { ...model(), locale: 'xx-XX' } },
      { id: 1, model: { ...model(), platform: 'android' } },
      // The view is never narrower than the folded rail, nor wider than any window.
      { id: 1, model: { ...model(), width: 40 } },
      { id: 1, model: { ...model(), width: 2_001 } },
      { id: 1, model: { ...model(), top: -1 } },
      { id: 1, model: { ...model(), tint: 'red' } },
      { id: 1, model: { ...model(), rail: { ...rail, tabs: [tab(' spaced ')] } } },
      { id: 1, model: { ...model(), rail: { ...rail, tabs: [tab('alpha', { faviconDataUrl: 'https://example.com/icon.png' })] } } },
      { id: 1, model: { ...model(), rail: { ...rail, tabs: [tab('alpha', { title: 't'.repeat(2_001) })] } } },
      { id: 1, model: { ...model(), rail: { ...rail, tabs: Array.from({ length: 1_001 }, (_, index) => tab(`tab-${index}`)) } } },
      { id: 1, model: { ...model(), rail: { ...rail, workspaces: [{ id: 'research', name: 'Research', description: '', color: 'teal' }] } } },
      { id: 1, model: { ...model(), rail: { ...rail, scrollTop: Number.NaN } } },
      { id: 1, model: { ...model(), footer: { ...model().footer, downloadCount: 100 } } },
      { id: 1, model: { ...model(), footer: { ...model().footer, mcp: { ...model().footer.mcp, state: { status: 'lost', paused: false } } } } }
    ]
    for (const value of bad) expect(() => parseSidebarOverlayRequest(value)).toThrow(TypeError)
  })

  it('finds the id of a reveal even in a request main refuses, so the shell can open its own rail', () => {
    expect(sidebarOverlayRequestId({ id: 7, model: null })).toBe(7)
    for (const value of [null, 'rail', { id: 0 }, { id: '3' }, { id: 2.5 }]) expect(sidebarOverlayRequestId(value)).toBeUndefined()
  })

  it('reads only well-formed reports from the view', () => {
    expect(parseSidebarOverlayRendered({ revision: 2 })).toEqual({ revision: 2 })
    for (const value of [null, { revision: 0 }, { revision: '2' }]) expect(parseSidebarOverlayRendered(value)).toBeNull()
    expect(parseSidebarOverlayPointer({ hovered: true, held: false, extra: 1 })).toEqual({ hovered: true, held: false })
    for (const value of [null, { hovered: 1, held: false }, { hovered: true }]) expect(parseSidebarOverlayPointer(value)).toBeNull()
  })

  it('reads only the commands the rail has, with well-formed ids, and nothing else they carry', () => {
    const good = [
      { kind: 'open-home' },
      { kind: 'select-tab', tabId: 'alpha' },
      { kind: 'close-tab', tabId: 'alpha' },
      { kind: 'toggle-tab-muted', tabId: 'alpha' },
      { kind: 'stop-worker-capture', tabId: 'alpha' },
      { kind: 'tab-context-menu', tabId: 'alpha' },
      { kind: 'reorder-tab', tabId: 'alpha', targetTabId: 'beta', placement: 'after' },
      { kind: 'new-tab' },
      { kind: 'new-tab', workspaceId: 'research' },
      { kind: 'workspace-context-menu', workspaceId: 'research' },
      { kind: 'toggle-workspace', workspaceId: 'research' },
      { kind: 'create-workspace' },
      { kind: 'switch-workspace' },
      { kind: 'stay-here' },
      { kind: 'toggle-rail-pinned' },
      { kind: 'drag-start' },
      { kind: 'scroll', top: 120 },
      { kind: 'dismiss' },
      { kind: 'footer', action: 'command-palette' },
      { kind: 'footer', action: 'mcp-pause' }
    ]
    for (const intent of good) expect(parseSidebarOverlayIntent({ ...intent, url: 'https://evil.example/' })).toEqual(intent)
    const bad: unknown[] = [
      null,
      { kind: 'navigate', url: 'https://evil.example/' },
      { kind: 'select-tab' },
      { kind: 'select-tab', tabId: '' },
      { kind: 'select-tab', tabId: ' alpha' },
      { kind: 'close-tab', tabId: 'x'.repeat(129) },
      { kind: 'reorder-tab', tabId: 'alpha', targetTabId: 'beta', placement: 'inside' },
      { kind: 'new-tab', workspaceId: 4 },
      { kind: 'scroll', top: -1 },
      { kind: 'scroll', top: Number.POSITIVE_INFINITY },
      { kind: 'footer', action: 'quit' }
    ]
    for (const value of bad) expect(parseSidebarOverlayIntent(value)).toBeNull()
  })
})

describe('sidebar overlay placement', () => {
  it('covers the open rail from the window\'s left edge, below the title bar, down to the bottom, at the shell zoom', () => {
    const layout: SidebarOverlayLayout = { content: { width: 1200, height: 800 }, zoom: 1 }
    expect(sidebarOverlayBounds({ width: 280, top: 48 }, layout)).toEqual({ x: 0, y: 48, width: 280, height: 752 })
    expect(sidebarOverlayBounds({ width: 280, top: 48 }, { content: { width: 1500, height: 1000 }, zoom: 1.25 }))
      .toEqual({ x: 0, y: 60, width: 350, height: 940 })
    // Never wider than the window, and nothing when no room is left below the title bar.
    expect(sidebarOverlayBounds({ width: 280, top: 0 }, { content: { width: 200, height: 800 }, zoom: 1 })).toEqual({ x: 0, y: 0, width: 200, height: 800 })
    expect(sidebarOverlayBounds({ width: 280, top: 48 }, { content: { width: 1200, height: 48 }, zoom: 1 })).toBeNull()
  })
})

interface Harness {
  overlay: SidebarOverlay
  surface: SidebarOverlaySurface & {
    sent: SidebarOverlayState[]
    bounds: Array<{ x: number; y: number; width: number; height: number }>
    zoom: number[]
    presented: number
    withdrawn: number
    focused: boolean
    destroyed: boolean
  }
  events: SidebarOverlayEvent[]
  layout: { current: SidebarOverlayLayout | null }
  cursor: { current: { x: number; y: number } | null }
  menus: Array<{ menu: SidebarOverlayMenu; closed: () => void }>
  focusShell: ReturnType<typeof vi.fn>
  /** Who has keyboard focus, other than the view. */
  focus: { owner: string | null }
  restoreFocus: ReturnType<typeof vi.fn>
  fail: { surface: boolean }
  flush: () => Promise<void>
}

function harness(): Harness {
  const surface: Harness['surface'] = {
    sent: [],
    bounds: [],
    zoom: [],
    presented: 0,
    withdrawn: 0,
    focused: false,
    destroyed: false,
    send(state) { this.sent.push(state) },
    setZoomFactor(zoom) { this.zoom.push(zoom) },
    setBounds(bounds) { this.bounds.push(bounds) },
    present() { this.presented += 1 },
    withdraw() { this.withdrawn += 1 },
    isFocused() { return this.focused },
    isDestroyed() { return this.destroyed }
  }
  const events: SidebarOverlayEvent[] = []
  const layout: Harness['layout'] = { current: { content: { width: 1200, height: 800 }, zoom: 1 } }
  const cursor: Harness['cursor'] = { current: null }
  const menus: Harness['menus'] = []
  const focusShell = vi.fn()
  const focus: Harness['focus'] = { owner: null }
  const restoreFocus = vi.fn()
  const fail = { surface: false }
  const overlay = new SidebarOverlay({
    surface: async () => {
      if (fail.surface) throw new Error('view failed to load')
      return surface
    },
    layout: () => layout.current,
    emit: (event) => events.push(event),
    cursor: () => cursor.current,
    showMenu: (menu, closed) => {
      menus.push({ menu, closed })
      return true
    },
    focusShell,
    focusOwner: () => focus.owner,
    restoreFocus
  })
  return { overlay, surface, events, layout, cursor, menus, focusShell, focus, restoreFocus, fail, flush: () => new Promise((resolve) => setTimeout(resolve, 0)) }
}

async function shown(overrides: Partial<SidebarOverlayModel> = {}, id = 1): Promise<Harness> {
  const test = harness()
  test.overlay.show({ id, model: model(overrides) })
  await test.flush()
  test.overlay.rendered({ revision: test.surface.sent.at(-1)!.revision })
  return test
}

describe('SidebarOverlay', () => {
  it('sends the rail to the view, and places and shows it only once the view has drawn that revision', async () => {
    const { overlay, surface, events, flush } = harness()
    overlay.show({ id: 1, model: model() })
    await flush()
    expect(surface.sent).toEqual([{ revision: 1, session: 1, model: model() }])
    expect(surface.zoom).toEqual([1])
    expect(surface.presented).toBe(0)
    expect(events).toEqual([])
    overlay.rendered({ revision: 1 })
    expect(surface.bounds).toEqual([{ x: 0, y: 48, width: 280, height: 752 }])
    expect(surface.presented).toBe(1)
    expect(overlay.shownId).toBe(1)
    expect(events).toEqual([{ id: 1, kind: 'shown' }, { id: 1, kind: 'pointer', hovered: false, held: false }])
  })

  it('draws at the shell zoom, with the view box in window coordinates', async () => {
    const { overlay, surface, layout, flush } = harness()
    layout.current = { content: { width: 1500, height: 1000 }, zoom: 1.25 }
    overlay.show({ id: 1, model: model() })
    await flush()
    expect(surface.zoom).toEqual([1.25])
    overlay.rendered({ revision: 1 })
    expect(surface.bounds).toEqual([{ x: 0, y: 60, width: 350, height: 940 }])
  })

  it('drops a report of an older revision, of another reveal, and of a reveal the shell closed', async () => {
    const { overlay, surface, events, flush } = harness()
    overlay.show({ id: 1, model: model() })
    await flush()
    // A tab loads while the view draws: the newer revision replaces the older one.
    overlay.show({ id: 1, model: model({ width: 300 }) })
    await flush()
    overlay.rendered({ revision: 1 })
    expect(surface.presented).toBe(0)
    overlay.rendered({ revision: 2 })
    expect(surface.bounds).toEqual([{ x: 0, y: 48, width: 300, height: 752 }])
    // A new reveal takes the place of the old one, and the old one's draw report means nothing for it.
    overlay.show({ id: 2, model: model() })
    expect(surface.withdrawn).toBe(1)
    await flush()
    overlay.rendered({ revision: 2 })
    expect(surface.presented).toBe(1)
    overlay.hide(2)
    overlay.rendered({ revision: 3 })
    expect(surface.presented).toBe(1)
    expect(events.filter((event) => event.kind === 'shown')).toEqual([{ id: 1, kind: 'shown' }])
  })

  it('updates the shown rail in place without taking it down', async () => {
    const { overlay, surface, events, flush } = await shown()
    overlay.show({ id: 1, model: model({ rail: { ...model().rail, activeTabId: 'beta' } }) })
    await flush()
    expect(surface.sent.at(-1)).toMatchObject({ revision: 2, session: 1 })
    expect(surface.withdrawn).toBe(0)
    overlay.rendered({ revision: 2 })
    expect(events.filter((event) => event.kind === 'shown')).toHaveLength(1)
  })

  it('tells the shell where the pointer is when the view appears under a still one, and what the view hears after', async () => {
    const test = harness()
    test.cursor.current = { x: 30, y: 400 }
    test.overlay.show({ id: 1, model: model() })
    await test.flush()
    test.overlay.rendered({ revision: 1 })
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: true, held: false })
    // Once the view hears the pointer, it knows best.
    test.overlay.pointer({ hovered: true, held: false })
    expect(test.events).toHaveLength(2)
    test.overlay.pointer({ hovered: false, held: true })
    test.overlay.pointer({ hovered: false, held: false })
    expect(test.events.slice(2)).toEqual([
      { id: 1, kind: 'pointer', hovered: false, held: true },
      { id: 1, kind: 'pointer', hovered: false, held: false }
    ])
  })

  it('takes the rail down when a dialog covers the page, and opens no new one while it does', async () => {
    const { overlay, surface, events } = await shown()
    overlay.occlusionChanged(true)
    expect(surface.withdrawn).toBe(1)
    expect(events.at(-1)).toEqual({ id: 1, kind: 'hidden', reason: 'occluded' })
    overlay.show({ id: 2, model: model() })
    expect(events.at(-1)).toEqual({ id: 2, kind: 'unavailable' })
    overlay.occlusionChanged(false)
    overlay.show({ id: 3, model: model() })
    expect(events.at(-1)).toEqual({ id: 2, kind: 'unavailable' })
  })

  it('takes the rail down when the window loses focus, unless a menu opened from the rail took it', async () => {
    const { overlay, surface, events, menus } = await shown()
    overlay.received({ kind: 'tab-context-menu', tabId: 'beta' })
    expect(menus.map(({ menu }) => menu)).toEqual([{ kind: 'tab', tabId: 'beta' }])
    // The open menu holds the rail open.
    expect(events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: true })
    overlay.dismiss('blur')
    expect(surface.withdrawn).toBe(0)
    menus[0]!.closed()
    expect(events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: false })
    overlay.dismiss('blur')
    expect(surface.withdrawn).toBe(1)
    expect(events.at(-1)).toEqual({ id: 1, kind: 'hidden', reason: 'blur' })
  })

  it('takes the rail down when the window cannot show it, as for a page in full screen, and follows a resized window', async () => {
    const { overlay, surface, events, layout, flush } = await shown()
    layout.current = { content: { width: 1000, height: 600 }, zoom: 1 }
    overlay.relayout()
    expect(surface.bounds.at(-1)).toEqual({ x: 0, y: 48, width: 280, height: 552 })
    expect(surface.sent).toHaveLength(1)
    // A new interface scale: drawn again at the new zoom before it moves.
    layout.current = { content: { width: 1000, height: 600 }, zoom: 1.5 }
    overlay.relayout()
    await flush()
    expect(surface.sent.at(-1)?.revision).toBe(2)
    expect(surface.zoom.at(-1)).toBe(1.5)
    overlay.rendered({ revision: 2 })
    expect(surface.bounds.at(-1)).toEqual({ x: 0, y: 72, width: 420, height: 528 })
    // The layout port has no window to draw in while a page is in full screen or the window is minimized.
    layout.current = null
    overlay.relayout()
    expect(surface.withdrawn).toBe(1)
    expect(events.at(-1)).toEqual({ id: 1, kind: 'hidden', reason: 'window' })
    expect(overlay.shownId).toBeUndefined()
  })

  it('tells the shell to open its own rail when the view cannot', async () => {
    const test = harness()
    test.fail.surface = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    test.overlay.show({ id: 1, model: model() })
    await test.flush()
    error.mockRestore()
    expect(test.events).toEqual([{ id: 1, kind: 'unavailable' }])
    // A later update of the same reveal does not try again; a new reveal does.
    test.fail.surface = false
    test.overlay.show({ id: 1, model: model() })
    await test.flush()
    expect(test.surface.sent).toEqual([])
    test.overlay.show({ id: 2, model: model() })
    await test.flush()
    expect(test.surface.sent).toHaveLength(1)
    // No room in the window: the shell opens its own.
    test.layout.current = { content: { width: 1200, height: 40 }, zoom: 1 }
    test.overlay.show({ id: 3, model: model() })
    expect(test.events.at(-1)).toEqual({ id: 3, kind: 'unavailable' })
    test.overlay.refused(4)
    expect(test.events.at(-1)).toEqual({ id: 4, kind: 'unavailable' })
  })

  it('passes on commands only from the shown rail, and only for the tabs and workspaces it shows', async () => {
    const { overlay, events, focusShell, surface } = await shown()
    const before = events.length
    overlay.received({ kind: 'select-tab', tabId: 'beta' })
    overlay.received({ kind: 'select-tab', tabId: 'gamma' })
    overlay.received({ kind: 'reorder-tab', tabId: 'alpha', targetTabId: 'gamma', placement: 'before' })
    overlay.received({ kind: 'toggle-workspace', workspaceId: 'research' })
    overlay.received({ kind: 'toggle-workspace', workspaceId: 'elsewhere' })
    overlay.received({ kind: 'new-tab', workspaceId: 'elsewhere' })
    overlay.received({ kind: 'footer', action: 'settings' })
    expect(events.slice(before)).toEqual([
      { id: 1, kind: 'intent', intent: { kind: 'select-tab', tabId: 'beta' } },
      { id: 1, kind: 'intent', intent: { kind: 'toggle-workspace', workspaceId: 'research' } },
      { id: 1, kind: 'intent', intent: { kind: 'footer', action: 'settings' } }
    ])
    // A click that gave the view keyboard focus hands it back to the shell, which runs the command; a scroll does not.
    expect(focusShell).not.toHaveBeenCalled()
    surface.focused = true
    overlay.received({ kind: 'scroll', top: 40 })
    expect(focusShell).not.toHaveBeenCalled()
    overlay.received({ kind: 'open-home' })
    expect(focusShell).toHaveBeenCalledOnce()
    overlay.hide(1)
    overlay.received({ kind: 'open-home' })
    expect(events.at(-1)).toEqual({ id: 1, kind: 'intent', intent: { kind: 'open-home' } })
  })

  it('puts the view\'s tooltips beside its controls in the shell\'s coordinates, with ids of their own', async () => {
    const { overlay } = await shown()
    const request = { id: 5, text: 'Close tab', anchor: { x: 250, y: 100, width: 32, height: 32 }, placement: 'right' as const, theme: 'dark' as const }
    expect(overlay.tooltip(request)).toEqual({ ...request, id: SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET + 5, anchor: { ...request.anchor, y: 148 } })
    overlay.hide(1)
    expect(overlay.tooltip(request)).toBeNull()
  })

  it('goes back above a page attached meanwhile, and gives the shell its rail when the view is lost', async () => {
    const { overlay, surface, events } = await shown()
    overlay.restack()
    expect(surface.presented).toBe(2)
    overlay.surfaceLost()
    expect(events.at(-1)).toEqual({ id: 1, kind: 'hidden', reason: 'lost' })
    overlay.restack()
    expect(surface.presented).toBe(2)
  })

  it('forgets the rail of a shell document that went, and gives back the keyboard focus a view it takes down had', async () => {
    const test = await shown()
    test.overlay.shellReset()
    expect(test.surface.withdrawn).toBe(1)
    expect(test.overlay.shownId).toBeUndefined()
    const other = await shown()
    other.surface.focused = true
    other.overlay.dismiss('window')
    expect(other.restoreFocus).toHaveBeenCalledOnce()
    // A dialog over the page takes it from the shell; a window that lost focus keeps its own.
    const covered = await shown()
    covered.surface.focused = true
    covered.overlay.occlusionChanged(true)
    expect(covered.focusShell).toHaveBeenCalledOnce()
    expect(covered.restoreFocus).not.toHaveBeenCalled()
    const blurred = await shown()
    blurred.surface.focused = true
    blurred.overlay.dismiss('blur')
    expect(blurred.focusShell).not.toHaveBeenCalled()
    expect(blurred.restoreFocus).not.toHaveBeenCalled()
  })

  it('does not bring back a rail it took down when the shell\'s update for it arrives after', async () => {
    // The shell keeps sending what the rail shows until it hears main took it down: here, the window lost focus.
    const test = await shown()
    test.overlay.dismiss('blur')
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'hidden', reason: 'blur' })
    test.overlay.show({ id: 1, model: model({ width: 300 }) })
    await test.flush()
    expect(test.surface.sent).toHaveLength(1)
    test.overlay.rendered({ revision: 2 })
    expect(test.surface.presented).toBe(1)
    expect(test.overlay.shownId).toBeUndefined()
    // Nor once the window shows again after it was minimized.
    const minimized = await shown()
    minimized.overlay.dismiss('window')
    minimized.overlay.show({ id: 1, model: model({ width: 300 }) })
    minimized.overlay.relayout()
    await minimized.flush()
    expect(minimized.surface.sent).toHaveLength(1)
    expect(minimized.overlay.shownId).toBeUndefined()
    expect(minimized.events.filter((event) => event.kind === 'shown')).toHaveLength(1)
  })

  it('keeps a rail the shell opens beside the page down when the window changes', async () => {
    // Refused: the shell opens its own rail and never closes this one.
    const refused = harness()
    refused.overlay.show({ id: 1, model: model() })
    await refused.flush()
    refused.overlay.refused(1)
    expect(refused.events).toEqual([{ id: 1, kind: 'unavailable' }])
    refused.overlay.relayout()
    await refused.flush()
    expect(refused.surface.sent).toHaveLength(1)
    refused.overlay.rendered({ revision: 1 })
    refused.overlay.rendered({ revision: 2 })
    expect(refused.surface.presented).toBe(0)
    // The view drew it, but the window had no room for it by then.
    const crowded = harness()
    crowded.overlay.show({ id: 1, model: model() })
    await crowded.flush()
    crowded.layout.current = { content: { width: 1200, height: 40 }, zoom: 1 }
    crowded.overlay.rendered({ revision: 1 })
    expect(crowded.events).toEqual([{ id: 1, kind: 'unavailable' }])
    crowded.layout.current = { content: { width: 1200, height: 800 }, zoom: 1 }
    crowded.overlay.relayout()
    await crowded.flush()
    expect(crowded.surface.sent).toHaveLength(1)
    crowded.overlay.rendered({ revision: 2 })
    expect(crowded.surface.presented).toBe(0)
    // The view failed to load.
    const failed = harness()
    failed.fail.surface = true
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    failed.overlay.show({ id: 1, model: model() })
    await failed.flush()
    error.mockRestore()
    failed.fail.surface = false
    failed.overlay.relayout()
    await failed.flush()
    expect(failed.surface.sent).toEqual([])
  })

  it('starts the view afresh for a new shell document\'s first reveal, whose id the shell numbers from 1 again', async () => {
    const test = await shown()
    const first = test.surface.sent[0]!.session
    test.overlay.shellReset()
    test.overlay.show({ id: 1, model: model() })
    await test.flush()
    expect(test.surface.sent).toHaveLength(2)
    expect(test.surface.sent[1]!.session).not.toBe(first)
    test.overlay.rendered({ revision: test.surface.sent[1]!.revision })
    expect(test.overlay.shownId).toBe(1)
  })

  it('gives the keyboard focus back where it was when the shell closes a rail that took it', async () => {
    const test = harness()
    test.focus.owner = 'page'
    test.overlay.show({ id: 1, model: model() })
    await test.flush()
    test.overlay.rendered({ revision: 1 })
    // As after a right-click menu, a click on the rail's scrollbar or on its blank space: the view keeps the focus.
    test.surface.focused = true
    test.overlay.hide(1)
    expect(test.restoreFocus).toHaveBeenCalledExactlyOnceWith('page')
    // Who had it as the pointer came onto the rail; the view itself never counts.
    test.surface.focused = false
    test.focus.owner = 'shell'
    test.overlay.show({ id: 2, model: model() })
    await test.flush()
    test.overlay.rendered({ revision: 2 })
    test.focus.owner = 'other page'
    test.overlay.pointerActivity()
    test.focus.owner = null
    test.overlay.pointerActivity()
    test.surface.focused = true
    // Another opening takes the place of this one.
    test.overlay.show({ id: 3, model: model() })
    expect(test.restoreFocus).toHaveBeenLastCalledWith('other page')
    // A view without the focus leaves it where it is.
    await test.flush()
    test.overlay.rendered({ revision: 3 })
    test.surface.focused = false
    test.overlay.hide(3)
    expect(test.restoreFocus).toHaveBeenCalledTimes(2)
    expect(test.focusShell).not.toHaveBeenCalled()
  })

  it('keeps the rail open under a still pointer when one of its menus closes', async () => {
    const test = await shown()
    test.overlay.pointer({ hovered: true, held: false })
    test.overlay.received({ kind: 'tab-context-menu', tabId: 'beta' })
    // The native menu takes the pointer, and the view hears it leave though it stays on the rail.
    test.overlay.pointer({ hovered: false, held: false })
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: true })
    test.cursor.current = { x: 30, y: 400 }
    test.menus[0]!.closed()
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: true, held: false })
    // Off the rail when it closes, the rail folds.
    test.overlay.received({ kind: 'tab-context-menu', tabId: 'alpha' })
    test.cursor.current = { x: 600, y: 400 }
    test.menus[1]!.closed()
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: false })
  })

  it('lets the rail fold when a drag from it ends off the rail, where the view heard nothing', async () => {
    const test = await shown()
    test.overlay.pointer({ hovered: true, held: true })
    test.cursor.current = { x: 600, y: 400 }
    // The view still thinks the pointer is over it once the drag ends.
    test.overlay.pointer({ hovered: true, held: false })
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: false })
    // One that ends on the rail keeps it open.
    test.overlay.pointer({ hovered: true, held: true })
    test.cursor.current = { x: 30, y: 400 }
    test.overlay.pointer({ hovered: true, held: false })
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: true, held: false })
  })

  // The view heard the pointer leave for the menu, so a pointer that then left the rail before moving over the view
  // left it nothing to report, and the rail stayed open over the page.
  it('follows a pointer that leaves the rail at once after one of its menus closes', async () => {
    const test = await shown()
    vi.useFakeTimers()
    try {
      test.overlay.pointer({ hovered: true, held: false })
      test.overlay.received({ kind: 'tab-context-menu', tabId: 'beta' })
      test.overlay.pointer({ hovered: false, held: false })
      test.cursor.current = { x: 270, y: 400 }
      test.menus[0]!.closed()
      expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: true, held: false })
      test.cursor.current = { x: 600, y: 400 }
      vi.advanceTimersByTime(100)
      expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: false })
      // Once the view speaks again, it is the one that knows.
      test.overlay.pointer({ hovered: true, held: false })
      const count = test.events.length
      test.cursor.current = { x: 30, y: 400 }
      test.overlay.pointer({ hovered: false, held: false })
      vi.advanceTimersByTime(500)
      expect(test.events.length).toBe(count + 1)
      expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: false })
    } finally {
      vi.useRealTimers()
    }
  })

  // The view still thought the pointer was over it, so it said nothing when the pointer came back, and the rail folded
  // under it.
  it('keeps the rail open when the pointer comes back after a drag ended off it', async () => {
    const test = await shown()
    vi.useFakeTimers()
    try {
      test.overlay.pointer({ hovered: true, held: true })
      test.cursor.current = { x: 600, y: 400 }
      test.overlay.pointer({ hovered: true, held: false })
      expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: false })
      test.cursor.current = { x: 30, y: 400 }
      vi.advanceTimersByTime(100)
      expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: true, held: false })
      // Leaving again, the view hears it.
      test.overlay.pointer({ hovered: false, held: false })
      expect(test.events.at(-1)).toEqual({ id: 1, kind: 'pointer', hovered: false, held: false })
      // Nothing is read once the rail is gone.
      test.overlay.pointer({ hovered: true, held: true })
      test.cursor.current = { x: 600, y: 400 }
      test.overlay.pointer({ hovered: true, held: false })
      test.overlay.hide(1)
      const count = test.events.length
      test.cursor.current = { x: 30, y: 400 }
      vi.advanceTimersByTime(500)
      expect(test.events.length).toBe(count)
    } finally {
      vi.useRealTimers()
    }
  })

  // Escape gave the keyboard to the shell before the shell closed the rail, so it never went back to the page.
  it('gives the keyboard back to the page that had it when Escape closes a focused rail', async () => {
    const test = harness()
    test.focus.owner = 'page'
    test.overlay.show({ id: 1, model: model() })
    await test.flush()
    test.overlay.rendered({ revision: 1 })
    test.surface.focused = true
    test.overlay.received({ kind: 'dismiss' })
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'intent', intent: { kind: 'dismiss' } })
    expect(test.focusShell).not.toHaveBeenCalled()
    test.overlay.hide(1)
    expect(test.restoreFocus).toHaveBeenCalledExactlyOnceWith('page')
  })

  it('gives the keyboard back when the shown view is lost', async () => {
    const test = harness()
    test.focus.owner = 'page'
    test.overlay.show({ id: 1, model: model() })
    await test.flush()
    test.overlay.rendered({ revision: 1 })
    test.overlay.surfaceLost()
    expect(test.restoreFocus).toHaveBeenCalledExactlyOnceWith('page')
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'hidden', reason: 'lost' })
  })

  it('takes the rail down rather than raise it over a page that went full screen meanwhile', async () => {
    const test = await shown()
    test.layout.current = null
    test.overlay.restack()
    expect(test.surface.presented).toBe(1)
    expect(test.surface.withdrawn).toBe(1)
    expect(test.events.at(-1)).toEqual({ id: 1, kind: 'hidden', reason: 'window' })
  })
})

describe('sidebar overlay IPC', () => {
  function registered(options: { startupFailure?: Error } = {}) {
    const handlers = new Map<string, (event: IpcMainEvent, value?: unknown) => void>()
    const overlay = { refused: vi.fn(), show: vi.fn(), hide: vi.fn(), rendered: vi.fn(), pointer: vi.fn(), received: vi.fn(), tooltip: vi.fn((request: unknown) => request) }
    const tooltips = { show: vi.fn(), hide: vi.fn(), measured: vi.fn(), shownId: undefined as number | undefined }
    const view = { webContents: {} }
    const assertMainShellSender = vi.fn((event: IpcMainEvent) => {
      if ((event as unknown as { shell?: boolean }).shell !== true) throw new Error('Rejected IPC from a non-shell renderer')
    })
    registerOverlayViewsIpc({ on: (channel: string, handler: (event: IpcMainEvent, value?: unknown) => void) => { handlers.set(channel, handler) } } as never, {
      assertMainShellSender,
      workspaceStartupFailure: () => options.startupFailure,
      shellTooltips: () => tooltips as never,
      agentCards: () => ({}) as never,
      toastOverlay: () => ({}) as never,
      agentCardView: () => ({ isSender: () => false }),
      toastOverlayView: () => ({ isSender: () => false }),
      tooltipView: () => ({ isSender: () => false }),
      sidebarOverlay: () => overlay as never,
      sidebarOverlayView: () => ({ isSender: (event: Pick<IpcMainEvent, 'sender'>) => event.sender === view.webContents })
    })
    const fromView = { sender: Object.assign(view.webContents, { getZoomFactor: () => 1.25 }) } as unknown as IpcMainEvent
    const fromShell = { shell: true, sender: {} } as unknown as IpcMainEvent
    const fromPage = { sender: { getZoomFactor: () => 1 } } as unknown as IpcMainEvent
    const send = (channel: string, event: IpcMainEvent, value?: unknown) => handlers.get(channel)!(event, value)
    return { overlay, tooltips, send, fromView, fromShell, fromPage }
  }

  it('admits the view\'s reports only from the view, and the shell\'s requests only from the shell', () => {
    const { overlay, send, fromView, fromShell, fromPage } = registered()
    for (const [channel, value] of [
      ['sidebar-overlay-view:rendered', { revision: 1 }],
      ['sidebar-overlay-view:pointer', { hovered: true, held: false }],
      ['sidebar-overlay-view:intent', { kind: 'open-home' }],
      ['sidebar-overlay-view:tooltip-show', { id: 1, text: 'Home', anchor: { x: 0, y: 0, width: 32, height: 32 }, placement: 'right', theme: 'dark' }],
      ['sidebar-overlay-view:tooltip-hide', 1]
    ] as const) {
      expect(() => send(channel, fromPage, value)).toThrow('Rejected IPC from a non-sidebar renderer')
      expect(() => send(channel, fromShell, value)).toThrow('Rejected IPC from a non-sidebar renderer')
    }
    expect(overlay.rendered).not.toHaveBeenCalled()
    expect(overlay.received).not.toHaveBeenCalled()
    expect(() => send('sidebar-overlay:show', fromView, { id: 1, model: model() })).toThrow('Rejected IPC from a non-shell renderer')
    expect(() => send('sidebar-overlay:hide', fromPage, 1)).toThrow('Rejected IPC from a non-shell renderer')
    expect(overlay.show).not.toHaveBeenCalled()
    send('sidebar-overlay:show', fromShell, { id: 1, model: model() })
    expect(overlay.show).toHaveBeenCalledWith({ id: 1, model: model() })
    send('sidebar-overlay-view:intent', fromView, { kind: 'select-tab', tabId: 'beta', url: 'https://evil.example/' })
    send('sidebar-overlay-view:intent', fromView, { kind: 'navigate', url: 'https://evil.example/' })
    expect(overlay.received.mock.calls).toEqual([[{ kind: 'select-tab', tabId: 'beta' }]])
  })

  it('refuses a request outside the contract so the shell opens its own rail, and draws nothing after a failed startup', () => {
    const { overlay, send, fromShell } = registered()
    expect(() => send('sidebar-overlay:show', fromShell, { id: 2, model: { ...model(), width: 10 } })).toThrow(TypeError)
    expect(overlay.refused).toHaveBeenCalledWith(2)
    expect(overlay.show).not.toHaveBeenCalled()
    const failed = registered({ startupFailure: new Error('workspaces did not start') })
    failed.send('sidebar-overlay:show', failed.fromShell, { id: 3, model: model() })
    expect(failed.overlay.refused).toHaveBeenCalledWith(3)
    expect(failed.overlay.show).not.toHaveBeenCalled()
    // Another sender's id ends nothing, which could keep the shell's later reveals from opening.
    expect(() => failed.send('sidebar-overlay:show', failed.fromPage, { id: 1_000_000, model: model() })).toThrow('Rejected IPC from a non-shell renderer')
    expect(failed.overlay.refused).toHaveBeenCalledTimes(1)
  })

  it('shows the view\'s tooltips at its zoom, and hides only its own', () => {
    const { tooltips, send, fromView } = registered()
    const request = { id: 1, text: 'Home', anchor: { x: 0, y: 0, width: 32, height: 32 }, placement: 'right', theme: 'dark' }
    send('sidebar-overlay-view:tooltip-show', fromView, request)
    expect(tooltips.show).toHaveBeenCalledWith(expect.objectContaining({ text: 'Home' }), 1.25)
    send('sidebar-overlay-view:tooltip-hide', fromView, 1)
    expect(tooltips.hide).toHaveBeenLastCalledWith(SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET + 1)
    tooltips.hide.mockClear()
    tooltips.shownId = 4
    send('sidebar-overlay-view:tooltip-hide', fromView)
    expect(tooltips.hide).not.toHaveBeenCalled()
    tooltips.shownId = SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET + 2
    send('sidebar-overlay-view:tooltip-hide', fromView)
    expect(tooltips.hide).toHaveBeenCalledWith(SIDEBAR_OVERLAY_TOOLTIP_ID_OFFSET + 2)
  })
})
