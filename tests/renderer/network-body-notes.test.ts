import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NetworkContentSearch from '../../src/renderer/src/features/network/NetworkContentSearch.vue'
import NetworkPanel from '../../src/renderer/src/features/network/NetworkPanel.vue'
import { createNetworkLabels } from '../../src/renderer/src/features/network/modules/network-labels.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { NETWORK_BODY_PLACEHOLDERS, NETWORK_BODY_UNAVAILABLE_REASONS } from '../../src/shared/network-body-notes.js'
import { sanitizeNetworkBody } from '../../src/shared/network-details.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import { searchNetworkDetails } from '../../src/shared/network-search.js'
import type {
  BrowserNetworkRequest,
  BrowserNetworkRequestDetails,
  BrowserNetworkSearchMatch,
  BrowserTabState,
  SupportedLocale
} from '../../src/shared/types.js'

const activeTab: BrowserTabState = {
  id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
  canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
  preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
}

const requests: BrowserNetworkRequest[] = [
  {
    id: 'upload', url: 'https://example.test/upload', method: 'POST', resourceType: 'fetch',
    startedAt: '2026-08-21T12:00:00.000Z', detailsAvailable: true
  },
  {
    id: 'image', url: 'https://example.test/logo.png', method: 'GET', resourceType: 'image',
    startedAt: '2026-08-21T12:00:01.000Z', status: 200, detailsAvailable: true
  }
]

const details: Record<string, BrowserNetworkRequestDetails> = {
  upload: {
    ...requests[0],
    request: { headers: {}, body: { text: NETWORK_BODY_PLACEHOLDERS.binary, originalChars: 12, truncated: false, redacted: true } },
    response: { headers: {}, body: { available: false, reason: NETWORK_BODY_UNAVAILABLE_REASONS.incomplete } }
  },
  image: {
    ...requests[1],
    request: { headers: {} },
    response: { headers: {}, body: { available: true, text: NETWORK_BODY_PLACEHOLDERS.nonText, originalChars: 9, truncated: false, redacted: true } }
  }
}

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

it('says in the interface language why a body is withheld or unavailable', async () => {
  // A German panel showed "[binary body omitted]" and "The response body has not completed." as Hronaut wrote them for agents.
  vi.stubGlobal('hronaut', {
    listNetworkRequests: vi.fn(async () => requests),
    listNetworkRoutes: vi.fn(async () => []),
    getNetworkRequestDetails: vi.fn(async (_tabId: string, requestId: string) => details[requestId])
  })
  const user = userEvent.setup()
  const view = render(NetworkPanel, { global: { plugins: [createHronautI18n('de-DE')] }, props: panelProps('de-DE', false) })
  try {
    await view.rerender(panelProps('de-DE', true))
    const [upload, image] = await within(await screen.findByRole('listbox', { name: 'Netzwerkanfragen' })).findAllByRole('option')

    await user.click(upload)
    const requestBody = (await screen.findByText('Anfragetext', { selector: 'summary', exact: false })).closest('details')!
    expect(requestBody.querySelector('p')?.textContent).toBe('Binärer Inhalt ausgelassen.')
    expect(requestBody.querySelector('pre')).toBeNull()
    const responseBody = screen.getByText('Antworttext', { selector: 'summary', exact: false }).closest('details')!
    expect(responseBody.querySelector('p')?.textContent).toBe('Der Antworttext ist noch nicht vollständig.')

    await user.click(image)
    await screen.findByText('Nicht-Text-Inhalt ausgelassen.')
    const imageBody = screen.getByText('Antworttext', { selector: 'summary', exact: false }).closest('details')!
    expect(imageBody.querySelector('pre')).toBeNull()
  } finally { view.unmount() }
})

it('names where content search found a match in the interface language', () => {
  // The German results listed "Response body", "received text message" and "tick event", the labels agents read.
  const found = searchNetworkDetails({
    tabId: 'tab-1',
    availableRequestCount: 1,
    details: [{
      ...requests[0], error: 'net::ERR_FAILED needle',
      request: { headers: {} },
      response: { headers: {}, body: { available: true, text: 'needle response' } },
      webSocket: { open: true, droppedMessages: 0, messages: [{ direction: 'received', timestamp: '2026-08-21T12:00:00.100Z', kind: 'text', sizeBytes: 6, text: 'needle' }] },
      eventSource: { open: true, droppedMessages: 0, messages: [{ timestamp: '2026-08-21T12:00:00.200Z', eventName: 'tick', sizeBytes: 6, data: 'needle', originalChars: 6, truncated: false, redacted: false }] }
    } as unknown as BrowserNetworkRequestDetails],
    options: { query: 'needle', caseSensitive: false, maxResults: 50, maxRequests: 50, maxBodyChars: 20_000 }
  })
  expect(found.matches.map((match) => match.label)).toEqual(['Request error', 'Response body', 'received text message', 'tick event'])
  const view = render(NetworkContentSearch, {
    global: { plugins: [createHronautI18n('de-DE')] },
    props: { open: true, query: 'needle', caseSensitive: false, state: 'complete', result: found, error: '', locale: 'de-DE' }
  })
  try {
    const names = view.container.querySelectorAll('.network-content-search-results strong')
    expect([...names].map((name) => name.textContent)).toEqual(['Anfragefehler', 'Antworttext', 'Nachricht (empfangen, Text)', 'Ereignis tick'])
    expect(screen.getByRole('button', { name: /Ereignis tick/ })).toBeTruthy()
  } finally { view.unmount() }
})

describe('network body notes', () => {
  it('keeps the English that agents and HAR files read', () => {
    expect(sanitizeNetworkBody('AAAA', 'image/png', 1_000, { base64Encoded: true }).text).toBe('[binary body omitted]')
    expect(sanitizeNetworkBody('--x', 'multipart/form-data; boundary=x', 1_000).text).toBe('[multipart body omitted]')
    expect(sanitizeNetworkBody('abc', 'application/octet-stream', 1_000).text).toBe('[non-text body omitted]')
    const i18n = createHronautI18n('en-US')
    const labels = createNetworkLabels((key, parameters) => i18n.global.t(key, parameters ?? {}))
    for (const reason of Object.values(NETWORK_BODY_UNAVAILABLE_REASONS)) expect(labels.bodyReason(reason)).toBe(reason)
    expect(labels.searchField({ field: 'websocket-message', label: 'sent binary message' })).toBe('sent binary message')
    expect(labels.searchField({ field: 'eventsource-message', label: 'tick event' })).toBe('tick event')
  })

  it('has a name for every note and field in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const i18n = createHronautI18n(locale)
      const missing: string[] = []
      i18n.global.setMissingHandler((_locale, key) => { missing.push(key); return key })
      const labels = createNetworkLabels((key, parameters) => i18n.global.t(key, parameters ?? {}))
      for (const text of Object.values(NETWORK_BODY_PLACEHOLDERS)) expect(labels.bodyPlaceholder({ text, redacted: true }), locale).toBeTruthy()
      for (const reason of Object.values(NETWORK_BODY_UNAVAILABLE_REASONS)) labels.bodyReason(reason)
      const fields: Array<Pick<BrowserNetworkSearchMatch, 'field' | 'label'>> = [
        { field: 'error', label: 'Request error' },
        { field: 'websocket-message', label: 'error close message' },
        { field: 'eventsource-message', label: 'message event' }
      ]
      for (const field of fields) labels.searchField(field)
      expect(missing, locale).toEqual([])
    }
  })

  it('shows text Hronaut does not recognize as it is', () => {
    const labels = createNetworkLabels(() => 'translated')
    expect(labels.bodyPlaceholder({ text: '{"ok":true}', redacted: true })).toBeUndefined()
    expect(labels.bodyPlaceholder(undefined)).toBeUndefined()
    // A page that sends the placeholder text itself still sees its own body.
    expect(labels.bodyPlaceholder({ text: NETWORK_BODY_PLACEHOLDERS.binary, redacted: false })).toBeUndefined()
    expect(labels.bodyReason('A reason from a newer main process.')).toBe('A reason from a newer main process.')
    expect(labels.searchField({ field: 'url', label: 'URL' })).toBe('URL')
    expect(labels.searchField({ field: 'request-header', label: 'x-trace' })).toBe('x-trace')
    expect(labels.searchField({ field: 'websocket-message', label: 'sideways text message' })).toBe('sideways text message')
  })
})
