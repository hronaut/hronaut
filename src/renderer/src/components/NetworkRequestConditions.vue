<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconKeyboardArrowDown from '~icons/material-symbols/keyboard-arrow-down-rounded'
import IconKeyboardArrowRight from '~icons/material-symbols/keyboard-arrow-right-rounded'
import IconKeyboardArrowUp from '~icons/material-symbols/keyboard-arrow-up-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import { formatNumber } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/locale'
import {
  BROWSER_NETWORK_ABORT_REASONS,
  type BrowserNetworkAbortReason,
  type BrowserNetworkRouteSummary
} from '../../../shared/types'

const props = defineProps<{
  routes: BrowserNetworkRouteSummary[]
  state: 'idle' | 'loading' | 'ready' | 'saving' | 'error'
  error: string
  locale: SupportedLocale
}>()

const emit = defineEmits<{
  move: [routeId: string, direction: 'up' | 'down']
  remove: [routeId: string]
  add: []
  clear: []
}>()

const expanded = defineModel<boolean>('expanded', { required: true })
const mode = defineModel<'abort' | 'fulfill' | 'throttle'>('mode', { required: true })
const pattern = defineModel<string>('pattern', { required: true })
const method = defineModel<string>('method', { required: true })
const times = defineModel<number>('times', { required: true })
const abort = defineModel<BrowserNetworkAbortReason>('abort', { required: true })
const throttle = defineModel<'fast-4g' | 'slow-4g' | 'slow-3g'>('throttle', { required: true })
const status = defineModel<number>('status', { required: true })
const headers = defineModel<string>('headers', { required: true })
const body = defineModel<string>('body', { required: true })
const { t } = useI18n({ useScope: 'global' })

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function networkProfileLabel(network: 'fast-4g' | 'slow-4g' | 'slow-3g'): string {
  if (network === 'slow-3g') return t('environment.network.slow3g')
  if (network === 'slow-4g') return t('environment.network.slow4g')
  return t('environment.network.fast4g')
}
</script>

<template>
  <section class="request-conditions" aria-labelledby="request-conditions-title">
    <UiButton native
      class="request-conditions-toggle"
      type="button"
      :aria-expanded="expanded"
      aria-controls="request-conditions-content"
      @click="expanded = !expanded"
    >
      <span class="request-conditions-toggle-copy">
        <IconRoute aria-hidden="true" />
        <span><strong id="request-conditions-title">{{ t('network.conditions.heading') }}</strong><small>{{ t('network.conditions.description') }}</small></span>
      </span>
      <span class="request-conditions-toggle-meta">
        <span v-if="routes.length" class="request-conditions-count">{{ t('network.conditions.active', { count: localNumber(routes.length) }, routes.length) }}</span>
        <IconKeyboardArrowDown v-if="expanded" aria-hidden="true" />
        <IconKeyboardArrowRight v-else aria-hidden="true" />
      </span>
    </UiButton>
    <div v-if="expanded" id="request-conditions-content" class="request-conditions-content">
      <p v-if="error" class="network-monitor-error" role="alert">{{ error }}</p>
      <div v-if="state === 'loading' && !routes.length" class="request-conditions-empty" role="status">
        <IconProgress class="state-spinner" aria-hidden="true" />
        {{ t('network.conditions.reading') }}
      </div>
      <div v-else-if="routes.length" class="request-condition-list" :aria-label="t('network.conditions.listAria')">
        <article v-for="(route, index) in routes" :key="route.id" class="request-condition-item">
          <span class="request-condition-order" :title="index === 0 ? t('network.conditions.firstWins') : t('network.conditions.priority', { number: localNumber(index + 1) })">{{ localNumber(index + 1) }}</span>
          <span class="request-condition-copy">
            <strong :title="route.urlPattern">{{ route.urlPattern }}</strong>
            <small>
              {{ route.method || t('network.conditions.anyMethod') }} ·
              <template v-if="route.behavior === 'abort'">{{ t('network.conditions.failAs', { reason: route.abort }) }}</template>
              <template v-else-if="route.behavior === 'fulfill'">{{ t('network.conditions.respond', { status: route.response?.status ?? '', bytes: localNumber(route.response?.bodyBytes || 0) }) }}</template>
              <template v-else>{{ t('network.conditions.throttleAs', { profile: networkProfileLabel(route.throttle || 'slow-4g') }) }}</template>
              <template v-if="route.remainingMatches !== undefined"> · {{ t('network.conditions.matchesLeft', { count: localNumber(route.remainingMatches) }, route.remainingMatches) }}</template>
              <template v-else> {{ t('network.conditions.untilRemoved') }}</template>
            </small>
          </span>
          <span class="request-condition-controls">
            <UiButton native type="button" :aria-label="t('network.conditions.moveUpAria', { pattern: route.urlPattern })" :title="t('network.conditions.moveUp')" :disabled="state === 'saving' || index === 0" @click="emit('move', route.id, 'up')"><IconKeyboardArrowUp aria-hidden="true" /></UiButton>
            <UiButton native type="button" :aria-label="t('network.conditions.moveDownAria', { pattern: route.urlPattern })" :title="t('network.conditions.moveDown')" :disabled="state === 'saving' || index === routes.length - 1" @click="emit('move', route.id, 'down')"><IconKeyboardArrowDown aria-hidden="true" /></UiButton>
            <UiButton native type="button" :aria-label="t('network.conditions.removeAria', { pattern: route.urlPattern })" :title="t('network.conditions.remove')" :disabled="state === 'saving'" @click="emit('remove', route.id)"><IconDelete aria-hidden="true" /></UiButton>
          </span>
        </article>
      </div>
      <div v-else class="request-conditions-empty">
        <IconRoute aria-hidden="true" />
        <span><strong>{{ t('network.conditions.empty') }}</strong><small>{{ t('network.conditions.emptyDescription') }}</small></span>
      </div>
      <form class="request-condition-form" :aria-label="t('network.conditions.formAria')" @submit.prevent="emit('add')">
        <h3>{{ t('network.conditions.addHeading') }}</h3>
        <label class="request-condition-pattern">
          <span>{{ t('network.conditions.urlPattern') }}</span>
          <input v-model="pattern" type="text" required maxlength="2048" placeholder="https://api.example.com/v1/*" spellcheck="false" />
        </label>
        <div class="request-condition-form-row">
          <label v-if="mode !== 'throttle'">
            <span>{{ t('network.conditions.method') }}</span>
            <select v-model="method">
              <option value="">{{ t('network.conditions.any') }}</option>
              <option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option><option>OPTIONS</option>
            </select>
          </label>
          <label>
            <span>{{ t('network.conditions.behavior') }}</span>
            <select v-model="mode">
              <option value="abort">{{ t('network.conditions.block') }}</option>
              <option value="fulfill">{{ t('network.conditions.mock') }}</option>
              <option value="throttle">{{ t('network.conditions.throttle') }}</option>
            </select>
          </label>
          <label v-if="mode !== 'throttle'">
            <span>{{ t('network.conditions.matches') }}</span>
            <input v-model.number="times" type="number" min="1" max="100" step="1" required />
          </label>
          <label v-else>
            <span>{{ t('network.conditions.networkProfile') }}</span>
            <select v-model="throttle" :aria-label="t('network.conditions.networkProfile')">
              <option value="fast-4g">{{ t('network.conditions.fast4g') }}</option>
              <option value="slow-4g">{{ t('network.conditions.slow4g') }}</option>
              <option value="slow-3g">{{ t('network.conditions.slow3g') }}</option>
            </select>
          </label>
        </div>
        <label v-if="mode === 'abort'">
          <span>{{ t('network.conditions.failureReason') }}</span>
          <select v-model="abort"><option v-for="reason in BROWSER_NETWORK_ABORT_REASONS" :key="reason" :value="reason">{{ reason }}</option></select>
        </label>
        <template v-else-if="mode === 'fulfill'">
          <label><span>{{ t('network.conditions.httpStatus') }}</span><input v-model.number="status" type="number" min="100" max="599" step="1" required /></label>
          <label><span>{{ t('network.conditions.responseHeaders') }} <small>{{ t('network.conditions.jsonValues') }}</small></span><textarea v-model="headers" rows="3" placeholder='{"content-type":"application/json"}' spellcheck="false" /></label>
          <label><span>{{ t('network.conditions.responseBody') }} <small>{{ t('network.conditions.maxBody') }}</small></span><textarea v-model="body" rows="4" placeholder='{"ok":false}' spellcheck="false" /></label>
        </template>
        <div class="request-condition-form-actions">
          <p><IconInfo aria-hidden="true" /> {{ t('network.conditions.safety') }}</p>
          <UiButton native type="submit" class="primary" :disabled="state === 'saving' || !pattern.trim()">
            <IconProgress v-if="state === 'saving'" class="state-spinner" aria-hidden="true" /><IconAdd v-else aria-hidden="true" />
            {{ state === 'saving' ? t('network.conditions.adding') : t('network.conditions.add') }}
          </UiButton>
        </div>
      </form>
      <div v-if="routes.length" class="request-conditions-actions">
        <span>{{ t('network.conditions.secretNote') }}</span>
        <UiButton native type="button" :disabled="state === 'saving'" @click="emit('clear')"><IconDelete aria-hidden="true" /> {{ t('network.conditions.removeAll') }}</UiButton>
      </div>
    </div>
  </section>
</template>
