<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { onBeforeUnmount, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCode from '~icons/material-symbols/code-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconDownloadDone from '~icons/material-symbols/download-done-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconKeyboardArrowDown from '~icons/material-symbols/keyboard-arrow-down-rounded'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconNetworkCheck from '~icons/material-symbols/network-check-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconReplay from '~icons/material-symbols/replay-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconTerminal from '~icons/material-symbols/terminal-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import {
  formatBytes as formatLocalizedBytes,
  formatNumber
} from '../../../shared/format'
import { networkResourceCategory } from '../../../shared/network-har'
import type {
  BrowserNetworkRequestSortBy,
  BrowserState,
  BrowserTabState,
  PanelDock,
  SupportedLocale
} from '../../../shared/types'
import { useNetworkController } from '../composables/useNetworkController'
import NetworkContentSearch from './NetworkContentSearch.vue'
import NetworkRequestConditions from './NetworkRequestConditions.vue'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  copyText: (text: string) => Promise<boolean>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  preservationBusy: boolean
  updatePreservation: (event: Event) => unknown
  keepsSeparatePanelOpen: () => boolean
}>()
const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  monitorState: networkMonitorState,
  requests: networkRequests,
  requestDetails: networkRequestDetails,
  selectedRequestId: networkSelectedRequestId,
  requestDetailsLoading: networkRequestDetailsLoading,
  monitorError: networkMonitorError,
  detailsCopied: networkDetailsCopied,
  replayState: networkReplayState,
  replayMessage: networkReplayMessage,
  search: networkSearch,
  contentSearchOpen: networkContentSearchOpen,
  contentSearchQuery: networkContentSearchQuery,
  contentSearchCaseSensitive: networkContentSearchCaseSensitive,
  contentSearchState: networkContentSearchState,
  contentSearchResult: networkContentSearchResult,
  contentSearchError: networkContentSearchError,
  resourceFilter: networkResourceFilter,
  failuresOnly: networkFailuresOnly,
  sortBy: networkSortBy,
  sortDirection: networkSortDirection,
  harCopied: networkHarCopied,
  harSaveState: networkHarSaveState,
  harExport: networkHarExport,
  requestConditionsExpanded,
  routes: networkRoutes,
  routeState: networkRouteState,
  routeError: networkRouteError,
  routeMode: networkRouteMode,
  routePattern: networkRoutePattern,
  routeMethod: networkRouteMethod,
  routeTimes: networkRouteTimes,
  routeAbort: networkRouteAbort,
  routeThrottle: networkRouteThrottle,
  routeStatus: networkRouteStatus,
  routeHeaders: networkRouteHeaders,
  routeBody: networkRouteBody,
  resourceFilters: networkResourceFilters,
  sortOptions: networkSortOptions,
  filteredRequests: filteredNetworkRequests,
  waterfallRange: networkWaterfallRange,
  failureCount: networkFailureCount,
  responseBytes: networkResponseBytes,
  reset: resetNetworkMonitorView,
  refresh: refreshNetworkMonitor,
  refreshRoutes: refreshNetworkRoutes,
  refreshAll: refreshNetwork,
  openRequestConditions,
  addRouteFromDraft: addNetworkRouteFromDraft,
  removeRoute: removeNetworkRoute,
  moveRoute: moveNetworkRoute,
  clearRoutes: clearActiveNetworkRoutes,
  selectRequest: selectNetworkRequest,
  replaySelectedRequest: replaySelectedNetworkRequest,
  selectRelatedRequest: selectRelatedNetworkRequest,
  closeContentSearch: closeNetworkContentSearch,
  toggleContentSearch: toggleNetworkContentSearch,
  runContentSearch: runNetworkContentSearch,
  selectSearchMatch: selectNetworkSearchMatch,
  copyDetails: copySanitizedNetworkDetails,
  copyHar: copySanitizedNetworkHar,
  saveHar: saveSanitizedNetworkHar,
  requestStatus: networkRequestStatus,
  requestDuration: networkRequestDuration,
  waterfallStyle: networkWaterfallStyle,
  waterfallLabel: networkWaterfallLabel,
  toggleSortDirection: toggleNetworkSortDirection,
  setSortBy: setNetworkSortByValue,
  requestName: networkRequestName,
  requestSourceSummary: networkRequestSourceSummary,
  initiatorLabel: networkInitiatorLabel,
  relationshipCount: networkRelationshipCount,
  sourceLocation: networkSourceLocation,
  formatMilliseconds: formatNetworkMilliseconds,
  timingRows: networkTimingRows,
  timingPercent: networkTimingPercent,
  canFormatRequestCopy: canFormatNetworkRequestCopy,
  isRequestFailure: isNetworkRequestFailure,
  responseSourceLabel: networkResponseSourceLabel,
  serviceWorkerSourceLabel: serviceWorkerResponseSourceLabel,
  replayRequiresConfirmation: networkReplayRequiresConfirmation,
  dispose
} = useNetworkController({
  activeTab: toRef(props, 'activeTab'),
  open,
  browser: window.hronaut,
  translate: (message, parameters) => t(message, parameters ?? {}),
  copyText: props.copyText,
  syncState: props.syncState,
  keepsSeparatePanelOpen: props.keepsSeparatePanelOpen
})

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function formatBytes(value: number): string {
  return formatLocalizedBytes(props.locale, value)
}

function debugTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(props.locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  }).format(date)
}

function setNetworkSortBy(event: Event): void {
  setNetworkSortByValue((event.target as HTMLSelectElement).value as BrowserNetworkRequestSortBy)
}

watch(
  () => [props.activeTab?.id, props.activeTab?.networkRouteCount] as const,
  ([tabId]) => {
    if (tabId && open.value) void refreshNetworkRoutes(true)
  }
)

defineExpose({
  reset: resetNetworkMonitorView,
  refresh: refreshNetworkMonitor,
  refreshRoutes: refreshNetworkRoutes,
  refreshAll: refreshNetwork,
  openRequestConditions
})
onBeforeUnmount(dispose)
</script>

<template>
    <section
      v-if="open"
      class="accessibility-panel network-monitor-panel"
      data-shell-docked-panel
      role="dialog"
      aria-modal="false"
      aria-labelledby="network-monitor-title"
      :aria-busy="networkMonitorState === 'loading'"
    >
      <header>
        <div>
          <span class="eyebrow">{{ t('network.kicker') }}</span>
          <h2 id="network-monitor-title">{{ t('network.heading') }}</h2>
        </div>
        <div class="network-monitor-header-actions">
          <PanelDockPicker v-model="dock" :label="t('panelDocks.network')" />
          <UiButton appearance="application"
            type="button"
            :class="{ active: networkContentSearchOpen }"
            :aria-label="t('network.searchContent')"
            :title="t('network.searchContentTitle')"
            @click="toggleNetworkContentSearch"
          ><IconSearch aria-hidden="true" /></UiButton>
          <UiButton appearance="application" type="button" :aria-label="t('network.refreshRequests')" :title="t('network.refresh')" @click="refreshNetworkMonitor()"><IconRefresh aria-hidden="true" /></UiButton>
          <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('network.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
        </div>
      </header>
      <NetworkRequestConditions
        v-model:expanded="requestConditionsExpanded"
        v-model:mode="networkRouteMode"
        v-model:pattern="networkRoutePattern"
        v-model:method="networkRouteMethod"
        v-model:times="networkRouteTimes"
        v-model:abort="networkRouteAbort"
        v-model:throttle="networkRouteThrottle"
        v-model:status="networkRouteStatus"
        v-model:headers="networkRouteHeaders"
        v-model:body="networkRouteBody"
        :routes="networkRoutes"
        :state="networkRouteState"
        :error="networkRouteError"
        :locale="locale"
        @move="moveNetworkRoute"
        @remove="removeNetworkRoute"
        @add="addNetworkRouteFromDraft"
        @clear="clearActiveNetworkRoutes"
      />
      <div class="network-monitor-tools">
        <label class="network-monitor-search">
          <IconSearch aria-hidden="true" />
          <input
            v-model="networkSearch"
            type="search"
            :aria-label="t('network.filterAria')"
            :placeholder="t('network.filterPlaceholder')"
            :title="t('network.filterTitle')"
            spellcheck="false"
          />
        </label>
        <div class="network-sort-controls">
          <label>
            <span>{{ t('network.sort') }}</span>
            <select :value="networkSortBy" :aria-label="t('network.sortAria')" @change="setNetworkSortBy">
              <option v-for="option in networkSortOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </label>
          <UiButton appearance="application"
            type="button"
            :aria-label="t('network.sortDirection', { direction: networkSortDirection === 'asc' ? t('network.ascending') : t('network.descending') })"
            :title="networkSortDirection === 'asc' ? t('network.ascendingTitle') : t('network.descendingTitle')"
            @click="toggleNetworkSortDirection"
          >
            <IconKeyboardArrowUp v-if="networkSortDirection === 'asc'" aria-hidden="true" />
            <IconKeyboardArrowDown v-else aria-hidden="true" />
          </UiButton>
        </div>
        <label class="network-failures-toggle">
          <input v-model="networkFailuresOnly" type="checkbox" />
          {{ t('network.failuresOnly') }}
          <span v-if="networkFailureCount">{{ localNumber(networkFailureCount) }}</span>
        </label>
        <label class="preserve-logs-toggle" :title="t('network.preserveTitle')">
          <input type="checkbox" :checked="activeTab?.preserveDiagnosticLogs" :disabled="preservationBusy" @change="updatePreservation" />
          {{ t('network.preserve') }}
        </label>
      </div>
      <div class="network-resource-filters" role="group" :aria-label="t('network.resourceFilterAria')">
        <UiButton appearance="application"
          v-for="filter in networkResourceFilters"
          :key="filter.value || 'all'"
          type="button"
          :class="{ active: networkResourceFilter === filter.value }"
          :aria-pressed="networkResourceFilter === filter.value"
          @click="networkResourceFilter = filter.value"
        >{{ filter.label }}</UiButton>
      </div>
      <NetworkContentSearch
        v-model:open="networkContentSearchOpen"
        v-model:query="networkContentSearchQuery"
        v-model:case-sensitive="networkContentSearchCaseSensitive"
        :state="networkContentSearchState"
        :result="networkContentSearchResult"
        :error="networkContentSearchError"
        :locale="locale"
        @search="runNetworkContentSearch"
        @close="closeNetworkContentSearch"
        @select="selectNetworkSearchMatch"
      />
      <p v-if="networkMonitorError" class="network-monitor-error" role="alert">{{ networkMonitorError }}</p>
      <div v-if="networkMonitorState === 'loading' && !networkRequests.length" class="network-monitor-empty" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('network.reading') }}</strong>
      </div>
      <div v-else class="network-monitor-workspace">
        <div class="network-request-list" role="listbox" :aria-label="t('network.requestsAria')">
          <UiButton appearance="application"
            v-for="request in filteredNetworkRequests"
            :key="request.id"
            type="button"
            role="option"
            :aria-selected="networkSelectedRequestId === request.id"
            :data-request-id="request.id"
            :class="{
              selected: networkSelectedRequestId === request.id,
              failed: isNetworkRequestFailure(request)
            }"
            @click="selectNetworkRequest(request)"
          >
            <span class="network-request-primary">
              <span class="network-request-status">{{ networkRequestStatus(request) }}</span>
              <strong :title="request.url">{{ networkRequestName(request) }}</strong>
              <small
                v-if="request.responseSource && request.responseSource !== 'network'"
                class="network-request-source"
                :title="networkRequestSourceSummary(request)"
              >{{ networkResponseSourceLabel(request.responseSource) }}</small>
            </span>
            <span class="network-request-meta">
              <span>{{ request.method }}</span>
              <span>{{ networkResourceCategory(request.resourceType) }}</span>
              <span>{{ request.responseSizeBytes !== undefined ? formatBytes(request.responseSizeBytes) : '—' }}</span>
              <span>{{ networkRequestDuration(request) }}</span>
            </span>
            <span
              v-if="networkWaterfallRange"
              class="network-request-waterfall"
              role="img"
              :aria-label="networkWaterfallLabel(request)"
              :title="networkWaterfallLabel(request)"
            >
              <i
                :class="{ pending: request.durationMs === undefined && !request.completedAt }"
                :style="networkWaterfallStyle(request)"
              />
            </span>
          </UiButton>
          <div v-if="!filteredNetworkRequests.length" class="network-monitor-empty compact">
            <IconNetworkCheck aria-hidden="true" />
            <strong>{{ networkRequests.length ? t('network.noMatches') : t('network.noRequests') }}</strong>
            <span>{{ networkRequests.length ? t('network.changeFilters') : t('network.useWebsite') }}</span>
          </div>
        </div>
        <div class="network-request-details" aria-live="polite">
          <div v-if="networkRequestDetailsLoading" class="network-monitor-empty compact" role="status">
            <IconProgress class="state-spinner" aria-hidden="true" />
            <strong>{{ t('network.detailsLoading') }}</strong>
          </div>
          <template v-else-if="networkRequestDetails">
            <header class="network-detail-heading">
              <span>{{ networkRequestDetails.method }}</span>
              <strong>{{ networkRequestStatus(networkRequestDetails) }}</strong>
              <small>{{ networkRequestDetails.response.protocol || networkRequestDetails.resourceType }}</small>
            </header>
            <code class="network-detail-url">{{ networkRequestDetails.url }}</code>
            <details v-if="networkRequestDetails.responseSource" class="network-response-origin" open>
              <summary>
                {{ t('network.details.responseSource') }}
                <span>{{ networkRequestSourceSummary(networkRequestDetails) }}</span>
              </summary>
              <dl>
                <template v-if="networkRequestDetails.serviceWorkerResponseSource">
                  <dt>{{ t('network.details.workerResponse') }}</dt>
                  <dd>{{ serviceWorkerResponseSourceLabel(networkRequestDetails.serviceWorkerResponseSource) }}</dd>
                </template>
                <template v-if="networkRequestDetails.cacheStorageCacheName">
                  <dt>{{ t('network.details.cacheName') }}</dt>
                  <dd><code>{{ networkRequestDetails.cacheStorageCacheName }}</code></dd>
                </template>
              </dl>
              <p v-if="networkRequestDetails.responseSource === 'network'">{{ t('network.details.directNetwork') }}</p>
            </details>
            <div class="network-detail-actions">
              <span>
                {{ t('network.details.evidence') }}<template v-if="canFormatNetworkRequestCopy(networkRequestDetails)"> {{ t('network.details.reviewCommands') }}</template>
              </span>
              <div class="network-detail-copy-actions">
                <UiButton appearance="application" variant="danger"
                  v-if="networkRequestDetails.resourceType.toLowerCase() === 'xhr'"
                  type="button"
                  :class="{
                    danger: networkReplayState === 'confirming',
                    complete: networkReplayState === 'replayed'
                  }"
                  :disabled="networkReplayState === 'replaying'"
                  :title="networkReplayRequiresConfirmation(networkRequestDetails.method)
                    ? t('network.details.replayRisk')
                    : t('network.details.replaySafe')"
                  @click="replaySelectedNetworkRequest"
                >
                  <IconProgress v-if="networkReplayState === 'replaying'" class="state-spinner" aria-hidden="true" />
                  <IconCheck v-else-if="networkReplayState === 'replayed'" aria-hidden="true" />
                  <IconWarning v-else-if="networkReplayState === 'confirming'" aria-hidden="true" />
                  <IconReplay v-else aria-hidden="true" />
                  {{ networkReplayState === 'confirming'
                    ? t('network.details.confirmReplay', { method: networkRequestDetails.method.toUpperCase() })
                    : networkReplayState === 'replaying'
                      ? t('network.details.replaying')
                      : networkReplayState === 'replayed'
                        ? t('network.details.replayed')
                        : t('network.details.replay') }}
                </UiButton>
                <UiButton appearance="application" type="button" @click="copySanitizedNetworkDetails('json')">
                  <IconCheck v-if="networkDetailsCopied === 'json'" aria-hidden="true" />
                  <IconCode v-else aria-hidden="true" />
                  {{ networkDetailsCopied === 'json' ? t('network.details.copiedJson') : t('network.details.copyJson') }}
                </UiButton>
                <UiButton appearance="application"
                  v-if="canFormatNetworkRequestCopy(networkRequestDetails)"
                  type="button"
                  @click="copySanitizedNetworkDetails('curl')"
                >
                  <IconCheck v-if="networkDetailsCopied === 'curl'" aria-hidden="true" />
                  <IconTerminal v-else aria-hidden="true" />
                  {{ networkDetailsCopied === 'curl' ? t('network.details.copiedCurl') : t('network.details.copyCurl') }}
                </UiButton>
                <UiButton appearance="application"
                  v-if="canFormatNetworkRequestCopy(networkRequestDetails)"
                  type="button"
                  @click="copySanitizedNetworkDetails('fetch')"
                >
                  <IconCheck v-if="networkDetailsCopied === 'fetch'" aria-hidden="true" />
                  <IconCopy v-else aria-hidden="true" />
                  {{ networkDetailsCopied === 'fetch' ? t('network.details.copiedFetch') : t('network.details.copyFetch') }}
                </UiButton>
              </div>
            </div>
            <p
              v-if="networkReplayMessage"
              class="network-replay-feedback"
              :class="networkReplayState"
              :role="networkReplayState === 'error' ? 'alert' : 'status'"
            >{{ networkReplayMessage }}</p>
            <details v-if="networkRequestDetails.initiator" open>
              <summary>{{ t('network.details.initiator') }} <span>{{ networkInitiatorLabel(networkRequestDetails.initiator.type) }}</span></summary>
              <div class="network-initiator-details">
                <p v-if="networkRequestDetails.initiator.redirectedFrom">
                  <strong>{{ t('network.details.redirectedFrom') }}</strong>
                  <code>{{ networkRequestDetails.initiator.redirectedFrom }}</code>
                </p>
                <p v-if="networkRequestDetails.initiator.url">
                  <strong>{{ t('network.details.source') }}</strong>
                  <code>{{ networkSourceLocation(networkRequestDetails.initiator.url, networkRequestDetails.initiator.lineNumber, networkRequestDetails.initiator.columnNumber) }}</code>
                </p>
                <ol v-if="networkRequestDetails.initiator.stack?.length" class="network-initiator-stack">
                  <li v-for="(frame, index) in networkRequestDetails.initiator.stack" :key="`${frame.url || 'inline'}:${frame.lineNumber}:${frame.columnNumber}:${index}`">
                    <strong>{{ frame.functionName || t('network.details.anonymous') }}</strong>
                    <code>{{ networkSourceLocation(frame.url, frame.lineNumber, frame.columnNumber) }}</code>
                  </li>
                </ol>
                <p v-if="networkRequestDetails.initiator.stackTruncated">{{ t('network.details.truncatedStack') }}</p>
                <p v-if="!networkRequestDetails.initiator.url && !networkRequestDetails.initiator.redirectedFrom && !networkRequestDetails.initiator.stack?.length">{{ t('network.details.initiatorUnavailable') }}</p>
              </div>
            </details>
            <details v-if="networkRequestDetails.relationships" open>
              <summary>
                {{ t('network.details.relationships') }}
                <span>{{ t('network.details.relatedCount', { count: localNumber(networkRelationshipCount(networkRequestDetails)) }, networkRelationshipCount(networkRequestDetails)) }}</span>
              </summary>
              <div class="network-relationship-details">
                <section v-if="networkRequestDetails.relationships.triggeredBy">
                  <header>
                    <strong>{{ t('network.details.triggeredBy') }}</strong>
                    <span>{{ t('network.details.reportedByChromium') }}</span>
                  </header>
                  <UiButton appearance="application"
                    type="button"
                    :aria-label="t('network.details.inspectTrigger', { request: networkRequestName(networkRequestDetails.relationships.triggeredBy) })"
                    @click="selectRelatedNetworkRequest(networkRequestDetails.relationships.triggeredBy)"
                  >
                    <span>
                      <strong>{{ networkRequestName(networkRequestDetails.relationships.triggeredBy) }}</strong>
                      <small>{{ networkRequestDetails.relationships.triggeredBy.method }} · {{ networkRequestDetails.relationships.triggeredBy.resourceType }}</small>
                    </span>
                    <code>{{ networkRequestStatus(networkRequestDetails.relationships.triggeredBy) }}</code>
                  </UiButton>
                </section>
                <section v-if="networkRequestDetails.relationships.redirectChain.length > 1">
                  <header>
                    <strong>{{ t('network.details.redirectChain') }}</strong>
                    <span>{{ t('network.details.retainedHops', { count: localNumber(networkRequestDetails.relationships.redirectChain.length) }, networkRequestDetails.relationships.redirectChain.length) }}</span>
                  </header>
                  <UiButton appearance="application"
                    v-for="(related, index) in networkRequestDetails.relationships.redirectChain"
                    :key="related.id"
                    type="button"
                    :disabled="related.id === networkRequestDetails.id"
                    :aria-current="related.id === networkRequestDetails.id ? 'true' : undefined"
                    :aria-label="related.id === networkRequestDetails.id
                      ? t('network.details.inspectCurrent', { request: networkRequestName(related) })
                      : t('network.details.inspectRedirect', { number: localNumber(index + 1), request: networkRequestName(related) })"
                    @click="selectRelatedNetworkRequest(related)"
                  >
                    <i>{{ index + 1 }}</i>
                    <span>
                      <strong>{{ networkRequestName(related) }}</strong>
                      <small>{{ related.id === networkRequestDetails.id ? t('network.details.currentRequest') : `${related.method} · ${related.resourceType}` }}</small>
                    </span>
                    <code>{{ networkRequestStatus(related) }}</code>
                  </UiButton>
                </section>
                <section v-if="networkRequestDetails.relationships.dependents.length">
                  <header>
                    <strong>{{ t('network.details.triggeredRequests') }}</strong>
                    <span>{{ t('network.details.directCount', { count: localNumber(networkRequestDetails.relationships.dependents.length) }, networkRequestDetails.relationships.dependents.length) }}</span>
                  </header>
                  <UiButton appearance="application"
                    v-for="related in networkRequestDetails.relationships.dependents"
                    :key="related.id"
                    type="button"
                    :aria-label="t('network.details.inspectTriggered', { request: networkRequestName(related) })"
                    @click="selectRelatedNetworkRequest(related)"
                  >
                    <span>
                      <strong>{{ networkRequestName(related) }}</strong>
                      <small>{{ related.method }} · {{ related.resourceType }}</small>
                    </span>
                    <code>{{ networkRequestStatus(related) }}</code>
                  </UiButton>
                </section>
                <p v-if="networkRequestDetails.relationships.truncated">{{ t('network.details.boundedRelationships') }}</p>
              </div>
            </details>
            <details v-if="networkRequestDetails.webSocket" open>
              <summary>
                {{ t('network.details.messages') }}
                <span>{{ localNumber(networkRequestDetails.webSocket.messages.length) }}<template v-if="networkRequestDetails.webSocket.droppedMessages"> {{ t('network.details.olderCount', { count: localNumber(networkRequestDetails.webSocket.droppedMessages) }) }}</template></span>
              </summary>
              <div class="network-websocket-summary">
                <span :class="networkRequestDetails.webSocket.open ? 'open' : 'closed'">{{ networkRequestDetails.webSocket.open ? t('network.details.connectionOpen') : t('network.details.connectionClosed') }}</span>
                <small>{{ t('network.details.socketSafety') }}</small>
              </div>
              <div v-if="networkRequestDetails.webSocket.messages.length" class="network-websocket-messages">
                <article
                  v-for="(message, index) in networkRequestDetails.webSocket.messages"
                  :key="`${message.timestamp}:${message.direction}:${index}`"
                  :class="[message.direction, message.kind]"
                >
                  <header>
                    <span>{{ message.direction }}</span>
                    <strong>{{ message.kind }}</strong>
                    <small>{{ debugTimestamp(message.timestamp) }}</small>
                    <code>{{ formatBytes(message.sizeBytes) }}</code>
                  </header>
                  <pre v-if="message.text">{{ message.text }}</pre>
                  <p v-else>{{ t('network.details.payloadOmitted', { kind: message.kind }) }}<template v-if="message.opcode !== undefined"> {{ t('network.details.opcode', { opcode: message.opcode }) }}</template>.</p>
                </article>
              </div>
              <p v-else>{{ t('network.details.noMessages') }}</p>
              <p v-if="networkRequestDetails.webSocket.droppedMessages">{{ t('network.details.olderMessages', { count: localNumber(networkRequestDetails.webSocket.droppedMessages) }, networkRequestDetails.webSocket.droppedMessages) }}</p>
            </details>
            <details v-if="networkRequestDetails.eventSource" open>
              <summary>
                {{ t('network.details.eventStream') }}
                <span>{{ localNumber(networkRequestDetails.eventSource.messages.length) }}<template v-if="networkRequestDetails.eventSource.droppedMessages"> {{ t('network.details.olderCount', { count: localNumber(networkRequestDetails.eventSource.droppedMessages) }) }}</template></span>
              </summary>
              <div class="network-websocket-summary">
                <span :class="networkRequestDetails.eventSource.open ? 'open' : 'closed'">{{ networkRequestDetails.eventSource.open ? t('network.details.streamOpen') : t('network.details.streamClosed') }}</span>
                <small>{{ t('network.details.eventSafety') }}</small>
              </div>
              <div v-if="networkRequestDetails.eventSource.messages.length" class="network-websocket-messages network-eventsource-messages">
                <article
                  v-for="(message, index) in networkRequestDetails.eventSource.messages"
                  :key="`${message.timestamp}:${message.eventName}:${message.eventId || ''}:${index}`"
                  class="received text"
                >
                  <header>
                    <span>{{ t('network.details.event') }}</span>
                    <strong>{{ message.eventName }}</strong>
                    <small :title="message.eventId ? t('network.details.eventId', { id: message.eventId }) : undefined">{{ message.eventId ? `${message.eventId} · ` : '' }}{{ debugTimestamp(message.timestamp) }}</small>
                    <code>{{ formatBytes(message.sizeBytes) }}</code>
                  </header>
                  <pre v-if="message.data">{{ message.data }}</pre>
                  <p v-else>{{ t('network.details.emptyEvent') }}</p>
                  <p v-if="message.truncated || message.redacted">{{ [message.truncated ? t('network.details.truncated') : '', message.redacted ? t('network.details.sanitized') : ''].filter(Boolean).join(' · ') }}</p>
                </article>
              </div>
              <p v-else>{{ t('network.details.noEvents') }}</p>
              <p v-if="networkRequestDetails.eventSource.droppedMessages">{{ t('network.details.olderEvents', { count: localNumber(networkRequestDetails.eventSource.droppedMessages) }, networkRequestDetails.eventSource.droppedMessages) }}</p>
            </details>
            <details v-if="networkRequestDetails.timing || networkRequestDetails.response.serverTiming?.length" open>
              <summary>{{ t('network.details.timing') }} <span>{{ networkRequestDetails.timing?.totalMs !== undefined ? formatNetworkMilliseconds(networkRequestDetails.timing.totalMs) : t('network.details.serverMetrics', { count: localNumber(networkRequestDetails.response.serverTiming?.length || 0) }, networkRequestDetails.response.serverTiming?.length || 0) }}</span></summary>
              <div v-if="networkRequestDetails.timing" class="network-timing-list">
                <div
                  v-for="phase in networkTimingRows(networkRequestDetails.timing)"
                  :key="phase.key"
                  :class="{ subphase: phase.subphase, total: phase.key === 'total' }"
                >
                  <span>{{ phase.label }}</span>
                  <span class="network-timing-bar" aria-hidden="true"><i :style="{ width: `${networkTimingPercent(phase.value, networkRequestDetails.timing)}%` }" /></span>
                  <strong>{{ formatNetworkMilliseconds(phase.value) }}</strong>
                </div>
              </div>
              <p v-if="networkRequestDetails.timing">{{ t('network.details.overlap') }}</p>
              <div v-if="networkRequestDetails.response.serverTiming?.length" class="network-server-timing">
                <header>
                  <strong>{{ t('network.details.serverTiming') }}</strong>
                  <span>{{ t('network.details.reportedByResponse') }}</span>
                </header>
                <div v-for="(metric, index) in networkRequestDetails.response.serverTiming" :key="`${metric.name}:${index}`">
                  <span>
                    <strong>{{ metric.name }}</strong>
                    <small v-if="metric.description">{{ metric.description }}</small>
                  </span>
                  <code>{{ metric.durationMs !== undefined ? formatNetworkMilliseconds(metric.durationMs) : t('network.details.noDuration') }}</code>
                </div>
                <p>{{ t('network.details.serverCaveat') }}</p>
              </div>
            </details>
            <details open>
              <summary>{{ t('network.details.requestHeaders') }} <span>{{ localNumber(Object.keys(networkRequestDetails.request.headers).length) }}</span></summary>
              <dl v-if="Object.keys(networkRequestDetails.request.headers).length" class="network-header-list">
                <template v-for="(value, name) in networkRequestDetails.request.headers" :key="name">
                  <dt>{{ name }}</dt><dd>{{ Array.isArray(value) ? value.join('\n') : value }}</dd>
                </template>
              </dl>
              <p v-else>{{ t('network.details.noRequestHeaders') }}</p>
            </details>
            <details v-if="networkRequestDetails.request.body">
              <summary>{{ t('network.details.requestBody') }} <span v-if="networkRequestDetails.request.body.redacted">{{ t('network.details.sanitized') }}</span></summary>
              <pre>{{ networkRequestDetails.request.body.text }}</pre>
            </details>
            <details open>
              <summary>{{ t('network.details.responseHeaders') }} <span>{{ localNumber(Object.keys(networkRequestDetails.response.headers).length) }}</span></summary>
              <dl v-if="Object.keys(networkRequestDetails.response.headers).length" class="network-header-list">
                <template v-for="(value, name) in networkRequestDetails.response.headers" :key="name">
                  <dt>{{ name }}</dt><dd>{{ Array.isArray(value) ? value.join('\n') : value }}</dd>
                </template>
              </dl>
              <p v-else>{{ t('network.details.noResponseHeaders') }}</p>
            </details>
            <details>
              <summary>{{ t('network.details.responseBody') }} <span v-if="networkRequestDetails.response.body.redacted">{{ t('network.details.sanitized') }}</span></summary>
              <pre v-if="networkRequestDetails.response.body.available">{{ networkRequestDetails.response.body.text }}</pre>
              <p v-else>{{ networkRequestDetails.response.body.reason }}</p>
            </details>
            <p class="network-detail-safety"><IconInfo aria-hidden="true" /> {{ t('network.details.safety') }}</p>
          </template>
          <div v-else class="network-monitor-empty compact">
            <IconNetworkCheck aria-hidden="true" />
            <strong>{{ t('network.selectRequest') }}</strong>
            <span>{{ t('network.selectDescription') }}</span>
          </div>
        </div>
      </div>
      <footer>
        <span>{{ t('network.summary', { visible: localNumber(filteredNetworkRequests.length), total: localNumber(networkRequests.length), bytes: formatBytes(networkResponseBytes) }) }}</span>
        <div class="network-monitor-actions">
          <UiButton appearance="application" type="button" :disabled="!networkRequests.length" @click="refreshNetworkMonitor(true)"><IconDelete aria-hidden="true" /> {{ t('network.clear') }}</UiButton>
          <UiButton appearance="application" type="button" :disabled="!filteredNetworkRequests.length" @click="copySanitizedNetworkHar">
            <IconCheck v-if="networkHarCopied" aria-hidden="true" />
            <IconCopy v-else aria-hidden="true" />
            {{ networkHarCopied ? t('network.copied') : t('network.copyHar') }}
          </UiButton>
          <UiButton appearance="application" variant="primary"
            type="button"
            class="primary"
            :title="networkHarExport?.path"
            :disabled="!filteredNetworkRequests.length || networkHarSaveState === 'saving'"
            @click="saveSanitizedNetworkHar"
          >
            <IconProgress v-if="networkHarSaveState === 'saving'" class="state-spinner" aria-hidden="true" />
            <IconDownloadDone v-else-if="networkHarSaveState === 'saved'" aria-hidden="true" />
            <IconDownload v-else aria-hidden="true" />
            {{ networkHarSaveState === 'saving' ? t('network.saving') : networkHarSaveState === 'saved' ? t('network.saved') : t('network.saveHar') }}
          </UiButton>
        </div>
      </footer>
    </section>
</template>
