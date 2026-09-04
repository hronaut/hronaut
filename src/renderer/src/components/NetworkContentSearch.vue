<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import { formatNumber } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/locale'
import { networkResourceCategory } from '../../../shared/network-har'
import type { BrowserNetworkSearchMatch, BrowserNetworkSearchResult } from '../../../shared/types'

const props = defineProps<{
  state: 'idle' | 'searching' | 'complete' | 'error'
  result: BrowserNetworkSearchResult | null
  error: string
  locale: SupportedLocale
}>()
const emit = defineEmits<{ search: []; close: []; select: [match: BrowserNetworkSearchMatch] }>()
const open = defineModel<boolean>('open', { required: true })
const query = defineModel<string>('query', { required: true })
const caseSensitive = defineModel<boolean>('caseSensitive', { required: true })
const input = ref<HTMLInputElement | null>(null)
const { t } = useI18n({ useScope: 'global' })

watch(open, (visible) => { if (visible) void nextTick(() => input.value?.focus()) })
function localNumber(value: number): string { return formatNumber(props.locale, value) }
function requestName(request: Pick<BrowserNetworkSearchMatch, 'url'>): string {
  try {
    const url = new URL(request.url)
    return `${url.pathname.split('/').filter(Boolean).at(-1) || url.hostname}${url.search}`
  } catch { return request.url }
}
</script>

<template>
  <section v-if="open" class="network-content-search" :aria-label="t('network.searchContent')">
    <form @submit.prevent="emit('search')">
      <label><IconSearch aria-hidden="true" /><input ref="input" v-model="query" type="search" :aria-label="t('network.contentSearch.aria')" :placeholder="t('network.contentSearch.aria')" maxlength="200" spellcheck="false" /></label>
      <label class="network-content-search-case"><input v-model="caseSensitive" type="checkbox" />{{ t('network.contentSearch.matchCase') }}</label>
      <UiButton appearance="application" variant="primary" type="submit" class="primary" :disabled="state === 'searching' || !query.trim()"><IconProgress v-if="state === 'searching'" class="state-spinner" aria-hidden="true" /><IconSearch v-else aria-hidden="true" />{{ state === 'searching' ? t('network.contentSearch.searching') : t('network.contentSearch.search') }}</UiButton>
      <UiButton appearance="application" type="button" :aria-label="t('network.contentSearch.close')" @click="emit('close')"><IconClose aria-hidden="true" /></UiButton>
    </form>
    <p v-if="error" class="network-content-search-error" role="alert">{{ error }}</p>
    <template v-if="result">
      <header><strong>{{ t('network.contentSearch.result', { fields: t('network.contentSearch.fieldCount', { count: localNumber(result.resultCount) }, result.resultCount), requests: t('network.contentSearch.requestCount', { count: localNumber(result.matchingRequestCount) }, result.matchingRequestCount) }) }}</strong><span>{{ t('network.contentSearch.searched', { searched: localNumber(result.searchedRequestCount), available: localNumber(result.availableRequestCount) }) }}<template v-if="result.truncated"> {{ t('network.contentSearch.bounded') }}</template></span></header>
      <div v-if="result.matches.length" class="network-content-search-results">
        <UiButton appearance="application" v-for="(match, index) in result.matches" :key="`${match.requestId}:${match.field}:${match.label}:${index}`" type="button" :aria-label="t('network.contentSearch.inspect', { number: localNumber(index + 1), label: match.label })" @click="emit('select', match)">
          <span><strong>{{ match.label }}</strong><small>{{ match.method }} · {{ match.status ?? t('network.noStatus') }} · {{ networkResourceCategory(match.resourceType) }} · {{ requestName(match) }}<template v-if="match.occurrenceCount > 1"> · {{ t('network.contentSearch.occurrenceCount', { count: localNumber(match.occurrenceCount) }, match.occurrenceCount) }}</template></small></span><code>{{ match.snippet }}</code>
        </UiButton>
      </div>
      <div v-else class="network-content-search-empty">{{ t('network.contentSearch.empty', { query: result.query }) }}</div>
      <footer>{{ t('network.contentSearch.safety') }}</footer>
    </template>
  </section>
</template>
