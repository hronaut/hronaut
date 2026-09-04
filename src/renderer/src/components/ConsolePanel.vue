<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconTerminal from '~icons/material-symbols/terminal-rounded'
import { formatNumber } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/locale'
import { browserConsoleLevel, type BrowserConsoleLevelFilter } from '../../../shared/console-messages'
import type { BrowserConsoleMessage, PanelDock } from '../../../shared/types'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  state: 'idle' | 'loading' | 'ready' | 'error'
  messages: BrowserConsoleMessage[]
  filteredMessages: BrowserConsoleMessage[]
  error: string
  copied: 'all' | 'filtered' | null
  copiedEntryKey: string | null
  messageCounts: Record<Exclude<BrowserConsoleLevelFilter, 'all'>, number>
  eventCount: number
  filteredEventCount: number
  preserveLogs: boolean
  preservationBusy: boolean
  locale: SupportedLocale
}>()

const emit = defineEmits<{
  preserveChange: [event: Event]
  clear: []
  refresh: []
  copyEntry: [message: BrowserConsoleMessage]
  copyAll: []
  copyFiltered: []
}>()

const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const search = defineModel<string>('search', { required: true })
const level = defineModel<BrowserConsoleLevelFilter>('level', { required: true })
const { t } = useI18n({ useScope: 'global' })

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
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

function sourceLocation(url: string | undefined, lineNumber?: number, columnNumber?: number): string {
  const position = lineNumber !== undefined
    ? `:${lineNumber}${columnNumber !== undefined ? `:${columnNumber}` : ''}`
    : ''
  return `${url || t('network.details.inlineScript')}${position}`
}

function levelLabel(value: string): string {
  if (value === 'error') return t('console.levels.error')
  if (value === 'warning') return t('console.levels.warning')
  if (value === 'verbose') return t('console.levels.verbose')
  return t('console.levels.info')
}

function entryKey(message: BrowserConsoleMessage): string {
  return `${message.timestamp}\n${message.sourceId}\n${message.lineNumber}\n${message.message}`
}
</script>

<template>
  <section
    v-if="open"
    class="accessibility-panel console-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="console-panel-title"
    :aria-busy="state === 'loading'"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('console.kicker') }}</span>
        <h2 id="console-panel-title">{{ t('console.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('console.heading') })" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('console.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div class="console-tools">
      <label class="network-monitor-search">
        <IconSearch aria-hidden="true" />
        <input v-model="search" type="search" :aria-label="t('console.filterAria')" :placeholder="t('console.filterPlaceholder')" spellcheck="false" />
      </label>
      <label class="console-level-filter">
        <span>{{ t('console.level') }}</span>
        <select v-model="level" :aria-label="t('console.levelAria')">
          <option value="all">{{ t('console.allLevels') }}</option>
          <option value="error">{{ t('console.errors', { count: localNumber(messageCounts.error) }) }}</option>
          <option value="warning">{{ t('console.warnings', { count: localNumber(messageCounts.warning) }) }}</option>
          <option value="info">{{ t('console.info', { count: localNumber(messageCounts.info) }) }}</option>
          <option value="verbose">{{ t('console.verbose', { count: localNumber(messageCounts.verbose) }) }}</option>
        </select>
      </label>
      <label class="preserve-logs-toggle" :title="t('console.preserveTitle')">
        <input type="checkbox" :checked="preserveLogs" :disabled="preservationBusy" @change="emit('preserveChange', $event)" />
        {{ t('console.preserve') }}
      </label>
    </div>
    <p v-if="error" class="network-monitor-error" role="alert">{{ error }}</p>
    <div v-if="state === 'loading' && !messages.length" class="network-monitor-empty" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" />
      <strong>{{ t('console.reading') }}</strong>
    </div>
    <div v-else class="console-messages" role="log" aria-live="polite" :aria-label="t('console.logAria')">
      <article
        v-for="(message, index) in filteredMessages"
        :key="`${message.timestamp}-${index}`"
        class="console-message"
        :class="browserConsoleLevel(message.level)"
      >
        <header>
          <span>{{ levelLabel(browserConsoleLevel(message.level)) }}</span>
          <small
            v-if="(message.repeatCount ?? 1) > 1"
            class="console-repeat"
            :aria-label="t('console.repeatedEvents', { count: localNumber(message.repeatCount ?? 0) }, message.repeatCount ?? 0)"
            :title="message.firstTimestamp ? t('console.repeatedSince', { time: debugTimestamp(message.firstTimestamp) }) : undefined"
          >×{{ message.repeatCount }}</small>
          <small v-if="message.handled" class="console-handled">{{ t('console.handledLater') }}</small>
          <time :datetime="message.timestamp">{{ debugTimestamp(message.timestamp) }}</time>
          <UiButton appearance="application" type="button" class="console-message-copy" :aria-label="t('console.copyEntry')" @click="emit('copyEntry', message)">
            <IconCheck v-if="copiedEntryKey === entryKey(message)" aria-hidden="true" />
            <IconCopy v-else aria-hidden="true" />
            {{ copiedEntryKey === entryKey(message) ? t('console.copied') : t('console.copy') }}
          </UiButton>
        </header>
        <code>{{ message.message }}</code>
        <small v-if="message.sourceId">{{ sourceLocation(message.sourceId, message.lineNumber, message.columnNumber) }}</small>
        <details v-if="message.stack?.length" class="console-stack">
          <summary>{{ t('console.callStack') }} <span>{{ localNumber(message.stack.length) }}{{ message.stackTruncated ? '+' : '' }}</span></summary>
          <ol>
            <li v-for="(frame, frameIndex) in message.stack" :key="`${frame.url || 'inline'}:${frame.lineNumber}:${frame.columnNumber}:${frameIndex}`">
              <span v-if="frame.async" class="console-async">{{ t('console.async') }}</span>
              <strong>{{ frame.functionName || t('console.anonymous') }}</strong>
              <code>{{ sourceLocation(frame.url, frame.lineNumber, frame.columnNumber) }}</code>
            </li>
          </ol>
          <p v-if="message.stackTruncated">{{ t('console.truncatedStack') }}</p>
        </details>
      </article>
      <div v-if="!filteredMessages.length" class="network-monitor-empty compact">
        <IconTerminal aria-hidden="true" />
        <strong>{{ messages.length ? t('console.noMatches') : t('console.noMessages') }}</strong>
        <span>{{ messages.length ? t('console.changeFilter') : t('console.useWebsite') }}</span>
      </div>
    </div>
    <footer>
      <span>{{ t('console.summary', { visible: localNumber(filteredMessages.length), total: localNumber(messages.length), visibleEvents: localNumber(filteredEventCount), totalEvents: localNumber(eventCount) }) }}</span>
      <div class="console-actions">
        <UiButton appearance="application" type="button" @click="emit('clear')"><IconDelete aria-hidden="true" /> {{ t('console.clear') }}</UiButton>
        <UiButton appearance="application" type="button" @click="emit('refresh')"><IconRefresh aria-hidden="true" /> {{ t('console.refresh') }}</UiButton>
        <UiButton appearance="application" type="button" :disabled="!messages.length" @click="emit('copyAll')">
          <IconCheck v-if="copied === 'all'" aria-hidden="true" />
          <IconCopy v-else aria-hidden="true" />
          {{ copied === 'all' ? t('console.copiedAll') : t('console.copyAll') }}
        </UiButton>
        <UiButton appearance="application" variant="primary" type="button" class="primary" :disabled="!filteredMessages.length" @click="emit('copyFiltered')">
          <IconCheck v-if="copied === 'filtered'" aria-hidden="true" />
          <IconCopy v-else aria-hidden="true" />
          {{ copied === 'filtered' ? t('console.copiedFiltered') : t('console.copyFiltered') }}
        </UiButton>
      </div>
    </footer>
  </section>
</template>
