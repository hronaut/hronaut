import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NetworkContentSearch from '../../src/renderer/src/components/NetworkContentSearch.vue'
import NetworkPanel from '../../src/renderer/src/components/NetworkPanel.vue'
import { createNetworkLabels } from '../../src/renderer/src/composables/network/network-labels.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import {
  networkResponseSourceLabel,
  serviceWorkerResponseSourceLabel
} from '../../src/shared/network-response-source.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import type {
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkResponseSource,
  BrowserNetworkSearchResult,
  BrowserServiceWorkerResponseSource,
  BrowserTabState,
  BrowserWebSocketMessageDirection,
  BrowserWebSocketMessageKind,
  SupportedLocale
} from '../../src/shared/types.js'

const RESPONSE_SOURCES: BrowserNetworkResponseSource[] = ['network', 'service-worker', 'prefetch-cache', 'disk-cache', 'other-cache']
const WORKER_SOURCES: BrowserServiceWorkerResponseSource[] = ['cache-storage', 'http-cache', 'fallback-code', 'network']
const MESSAGE_DIRECTIONS: BrowserWebSocketMessageDirection[] = ['sent', 'received', 'error']
const MESSAGE_KINDS: BrowserWebSocketMessageKind[] = ['text', 'binary', 'continuation', 'close', 'ping', 'pong', 'error', 'unknown']

const activeTab: BrowserTabState = {
  id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
  canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
  preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
}

const requests: BrowserNetworkRequest[] = [
  {
    id: 'cached', url: 'https://example.test/api/items', method: 'GET', resourceType: 'fetch',
    startedAt: '2026-08-21T12:00:00.000Z', status: 200, detailsAvailable: true, responseSource: 'disk-cache'
  },
  {
    id: 'socket', url: 'wss://example.test/socket', method: 'GET', resourceType: 'websocket',
    startedAt: '2026-08-21T12:00:01.000Z', status: 101, detailsAvailable: true
  },
  {
    id: 'font', url: 'https://example.test/font.woff2', method: 'GET', resourceType: 'font',
    startedAt: '2026-08-21T12:00:02.000Z', status: 200, detailsAvailable: true,
    responseSource: 'service-worker', serviceWorkerResponseSource: 'http-cache'
  }
]

const socketDetails = {
  ...requests[1],
  request: { headers: {} },
  response: { headers: {}, protocol: '', body: { available: false } },
  initiator: { type: 'script', url: 'https://example.test/app.js', lineNumber: 3, columnNumber: 7 },
  relationships: {
    triggeredBy: { ...requests[2], id: 'script', url: 'https://example.test/app.js', resourceType: 'script' },
    redirectChain: [],
    dependents: [],
    truncated: false
  },
  webSocket: {
    open: true,
    droppedMessages: 0,
    messages: [
      { direction: 'sent', timestamp: '2026-08-21T12:00:01.100Z', kind: 'text', sizeBytes: 5, text: 'hello' },
      { direction: 'received', timestamp: '2026-08-21T12:00:01.200Z', kind: 'binary', opcode: 2, sizeBytes: 9 }
    ]
  }
} as unknown as BrowserNetworkRequestDetails

const fontDetails = {
  ...requests[2],
  request: { headers: {} },
  response: { headers: {}, protocol: '', body: { available: false } }
} as unknown as BrowserNetworkRequestDetails

afterEach(() => {
  vi.unstubAllGlobals()
})

function panelProps(locale: SupportedLocale, open: boolean) {
  return {
    open, dock: 'right' as const, activeTab, locale, copyText: vi.fn(async () => true),
    syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
    preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
  }
}

it('names request types, sources, initiators and messages in the interface language', async () => {
  // These showed Chromium's English codes, such as "fetch/xhr", "Disk cache" and "received binary", in a German panel.
  vi.stubGlobal('hronaut', {
    listNetworkRequests: vi.fn(async () => requests),
    listNetworkRoutes: vi.fn(async () => []),
    getNetworkRequestDetails: vi.fn(async (_tabId: string, requestId: string) => requestId === 'font' ? fontDetails : socketDetails)
  })
  const user = userEvent.setup()
  const view = render(NetworkPanel, { global: { plugins: [createHronautI18n('de-DE')] }, props: panelProps('de-DE', false) })
  try {
    await view.rerender(panelProps('de-DE', true))
    const list = await screen.findByRole('listbox', { name: 'Netzwerkanfragen' })
    const [cached, socket, font] = await within(list).findAllByRole('option')
    expect(cached.textContent).toContain('Festplatten-Cache')
    expect(cached.textContent).toContain('Fetch/XHR')
    expect(cached.textContent).not.toContain('fetch/xhr')
    expect(socket.textContent).toContain('WS')
    expect(font.textContent).toContain('Service Worker')
    expect(font.textContent).toContain('Andere')

    await user.click(socket)
    const initiator = await screen.findByText('Initiator', { selector: 'summary', exact: false })
    expect(initiator.textContent).toContain('Skript')
    const trigger = screen.getByRole('button', { name: /app\.js/ })
    expect(trigger.textContent).toContain('GET · Skript')
    const [sent, received] = document.querySelectorAll('.network-websocket-messages article')
    expect(sent.querySelector('header > span')?.textContent).toBe('gesendet')
    expect(sent.querySelector('header > strong')?.textContent).toBe('Text')
    expect(received.querySelector('header > span')?.textContent).toBe('empfangen')
    expect(received.querySelector('header > strong')?.textContent).toBe('binär')
    expect(received.querySelector('p')?.textContent).toMatch(/^Nutzdaten ausgelassen: binär/)

    await user.click(font)
    expect((await screen.findByText('Schriftart', { selector: '.network-detail-heading small' })).textContent).toBe('Schriftart')
    expect(screen.getByText('Service Worker · HTTP-Cache')).toBeTruthy()
  } finally { view.unmount() }
})

it('names a content search match’s request type in the interface language', () => {
  const result: BrowserNetworkSearchResult = {
    tabId: 'tab-1', query: 'needle', caseSensitive: false, searchedAt: '2026-08-21T12:00:00.000Z',
    availableRequestCount: 1, searchedRequestCount: 1, matchingRequestCount: 1, resultCount: 1, occurrenceCount: 1,
    unavailableResponseBodyCount: 0, truncated: false, caveats: [],
    matches: [{
      requestId: 'image', url: 'https://example.test/logo.png', method: 'GET', resourceType: 'image', status: 200,
      field: 'url', label: 'URL', snippet: 'needle', occurrenceCount: 1
    }]
  }
  const view = render(NetworkContentSearch, {
    global: { plugins: [createHronautI18n('de-DE')] },
    props: { open: true, query: 'needle', caseSensitive: false, state: 'complete', result, error: '', locale: 'de-DE' }
  })
  try {
    // The match showed "image" here, Chromium's code, in a German panel.
    expect(screen.getByRole('button', { name: /URL/ }).textContent).toContain('GET · 200 · Bild · logo.png')
  } finally { view.unmount() }
})

describe('network labels', () => {
  it('keeps the English source names the panel showed before', () => {
    const i18n = createHronautI18n('en-US')
    const labels = createNetworkLabels((key, parameters) => i18n.global.t(key, parameters ?? {}))
    for (const source of RESPONSE_SOURCES) expect(labels.responseSource(source)).toBe(networkResponseSourceLabel(source))
    for (const source of WORKER_SOURCES) expect(labels.serviceWorkerSource(source)).toBe(serviceWorkerResponseSourceLabel(source))
    // Chromium's lowercased codes now read as names in English too.
    expect(labels.initiator('signedexchange')).toBe('Signed exchange')
    expect(labels.requestCategory('Fetch')).toBe('Fetch/XHR')
    for (const direction of MESSAGE_DIRECTIONS) expect(labels.messageDirection(direction)).toBe(direction)
    for (const kind of MESSAGE_KINDS) expect(labels.messageKind(kind)).toBe(kind)
  })

  it('has a name for every known code in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale)
      const missing: string[] = []
      i18n.global.setMissingHandler((_locale, key) => { missing.push(key); return key })
      const labels = createNetworkLabels((key, parameters) => i18n.global.t(key, parameters ?? {}))
      for (const type of ['Document', 'Stylesheet', 'Image', 'Media', 'Font', 'Script', 'TextTrack', 'XHR', 'Fetch', 'Prefetch',
        'EventSource', 'WebSocket', 'Manifest', 'SignedExchange', 'Ping', 'CSPViolationReport', 'Preflight', 'FedCM', 'Other']) labels.resourceType(type)
      for (const type of ['parser', 'script', 'preload', 'signedexchange', 'preflight', 'fedcm', 'redirect', 'other']) labels.initiator(type)
      for (const category of ['fetch/xhr', 'document', 'image', 'other']) labels.categoryLabel(category)
      for (const source of RESPONSE_SOURCES) labels.responseSource(source)
      for (const source of WORKER_SOURCES) labels.serviceWorkerSource(source)
      for (const direction of MESSAGE_DIRECTIONS) labels.messageDirection(direction)
      for (const kind of MESSAGE_KINDS) labels.messageKind(kind)
      expect(missing, locale).toEqual([])
    }
  })

  it('shows a code Hronaut does not know as Chromium reported it', () => {
    const labels = createNetworkLabels(() => 'translated')
    expect(labels.resourceType('Beacon')).toBe('Beacon')
    expect(labels.categoryLabel('toString')).toBe('toString')
    expect(labels.initiator('speculation_rules')).toBe('Speculation rules')
    expect(labels.responseSource('__proto__' as BrowserNetworkResponseSource)).toBe('__proto__')
    expect(labels.messageKind('constructor' as never)).toBe('constructor')
  })
})
