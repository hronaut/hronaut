import { networkBodyPlaceholder, networkBodyUnavailableReason } from '../../../../../shared/network-body-notes.js'
import { networkResourceCategory } from '../../../../../shared/network-har.js'
import type {
  BrowserNetworkResponseSource,
  BrowserNetworkSearchMatch,
  BrowserServiceWorkerResponseSource,
  BrowserWebSocketMessageDirection,
  BrowserWebSocketMessageKind
} from '../../../../../shared/types.js'

type Translate = (key: string, parameters?: Record<string, string | number>) => string

// The Network panel names Chromium's codes in the interface language. Filters,
// HAR files and MCP results keep the codes and English text from src/shared,
// and a code Hronaut does not know yet is shown as Chromium reported it.

const RESOURCE_CATEGORY_KEYS: Record<string, string> = {
  'fetch/xhr': 'network.filters.fetchXhr',
  document: 'network.filters.document',
  image: 'network.filters.image',
  other: 'network.filters.other'
}

// Developers read these as the same short names in every language.
const RESOURCE_CATEGORY_ACRONYMS: Record<string, string> = {
  script: 'JS',
  stylesheet: 'CSS',
  eventsource: 'SSE',
  websocket: 'WS'
}

const RESOURCE_TYPES = new Set([
  'document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'prefetch',
  'eventsource', 'websocket', 'manifest', 'signedexchange', 'ping', 'cspviolationreport', 'preflight', 'fedcm', 'other'
])

const RESPONSE_SOURCE_KEYS: Record<BrowserNetworkResponseSource, string> = {
  network: 'network',
  'service-worker': 'serviceWorker',
  'prefetch-cache': 'prefetchCache',
  'disk-cache': 'diskCache',
  'other-cache': 'otherCache'
}

const WORKER_SOURCE_KEYS: Record<BrowserServiceWorkerResponseSource, string> = {
  'cache-storage': 'cacheStorage',
  'http-cache': 'httpCache',
  'fallback-code': 'fallbackCode',
  network: 'network'
}

const INITIATOR_TYPES = new Set(['parser', 'script', 'preload', 'signedexchange', 'preflight', 'fedcm', 'redirect', 'other'])
const MESSAGE_DIRECTIONS = new Set<string>(['sent', 'received', 'error'] satisfies BrowserWebSocketMessageDirection[])
const MESSAGE_KINDS = new Set<string>([
  'text', 'binary', 'continuation', 'close', 'ping', 'pong', 'error', 'unknown'
] satisfies BrowserWebSocketMessageKind[])

export function createNetworkLabels(translate: Translate) {
  /** The filter chip's name for a group of requests, such as fetch/xhr. */
  function categoryLabel(category: string): string {
    if (Object.hasOwn(RESOURCE_CATEGORY_KEYS, category)) return translate(RESOURCE_CATEGORY_KEYS[category])
    return Object.hasOwn(RESOURCE_CATEGORY_ACRONYMS, category) ? RESOURCE_CATEGORY_ACRONYMS[category] : category
  }

  /** The filter chip's name for the group a request of this type belongs to. */
  function requestCategory(resourceType: string): string {
    return categoryLabel(networkResourceCategory(resourceType))
  }

  function resourceType(type: string): string {
    const normalized = type.toLowerCase()
    return RESOURCE_TYPES.has(normalized) ? translate(`networkLabels.resourceTypes.${normalized}`) : type
  }

  function responseSource(source: BrowserNetworkResponseSource): string {
    return Object.hasOwn(RESPONSE_SOURCE_KEYS, source)
      ? translate(`networkLabels.responseSources.${RESPONSE_SOURCE_KEYS[source]}`)
      : source
  }

  function serviceWorkerSource(source: BrowserServiceWorkerResponseSource): string {
    return Object.hasOwn(WORKER_SOURCE_KEYS, source)
      ? translate(`networkLabels.workerSources.${WORKER_SOURCE_KEYS[source]}`)
      : source
  }

  function initiator(type: string): string {
    const normalized = type.toLowerCase()
    if (INITIATOR_TYPES.has(normalized)) return translate(`networkLabels.initiatorTypes.${normalized}`)
    return type.replace(/[-_]/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
  }

  function messageDirection(direction: BrowserWebSocketMessageDirection): string {
    return MESSAGE_DIRECTIONS.has(direction) ? translate(`networkLabels.messageDirections.${direction}`) : direction
  }

  function messageKind(kind: BrowserWebSocketMessageKind): string {
    return MESSAGE_KINDS.has(kind) ? translate(`networkLabels.messageKinds.${kind}`) : kind
  }

  /**
   * The note shown instead of a body Hronaut withheld, or undefined for a real body. Hronaut marks
   * every withheld body redacted, so a page that sends the placeholder text itself still sees its body.
   */
  function bodyPlaceholder(body: { text?: string; redacted?: boolean } | undefined): string | undefined {
    const placeholder = body?.redacted === true ? networkBodyPlaceholder(body.text) : undefined
    return placeholder ? translate(`networkLabels.bodyNotes.${placeholder}`) : undefined
  }

  function bodyReason(reason: string | undefined): string | undefined {
    const known = networkBodyUnavailableReason(reason)
    return known ? translate(`networkLabels.bodyReasons.${known}`) : reason
  }

  /** Where a content search match was found. URLs and header names keep their own text. */
  function searchField(match: Pick<BrowserNetworkSearchMatch, 'field' | 'label'>): string {
    if (match.field === 'error') return translate('networkLabels.searchFields.error')
    if (match.field === 'request-body') return translate('network.details.requestBody')
    if (match.field === 'response-body') return translate('network.details.responseBody')
    if (match.field === 'websocket-message') {
      const [, direction, kind] = /^(\S+) (\S+) message$/.exec(match.label) ?? []
      if (MESSAGE_DIRECTIONS.has(direction) && MESSAGE_KINDS.has(kind)) {
        return translate('networkLabels.searchFields.message', {
          direction: messageDirection(direction as BrowserWebSocketMessageDirection),
          kind: messageKind(kind as BrowserWebSocketMessageKind)
        })
      }
    }
    if (match.field === 'eventsource-message') {
      const name = /^([\s\S]*) event$/.exec(match.label)?.[1]
      if (name !== undefined) return translate('networkLabels.searchFields.event', { name })
    }
    return match.label
  }

  return {
    categoryLabel,
    requestCategory,
    resourceType,
    responseSource,
    serviceWorkerSource,
    initiator,
    messageDirection,
    messageKind,
    bodyPlaceholder,
    bodyReason,
    searchField
  }
}

export type NetworkLabels = ReturnType<typeof createNetworkLabels>
