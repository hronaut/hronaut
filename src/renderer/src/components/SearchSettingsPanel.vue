<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import { SEARCH_ENGINE_OPTIONS } from '../../../shared/search-engine.js'
import type { SearchSettingsController } from '../composables/useSearchSettingsController.js'

const props = defineProps<{
  controller: SearchSettingsController
}>()

const { t } = useI18n({ useScope: 'global' })
const { settings, busy, select } = props.controller
</script>

<template>
  <div class="settings-content">
    <div class="setting-copy">
      <h3>{{ t('settings.search.heading') }}</h3>
      <p>{{ t('settings.search.description') }}</p>
    </div>
    <div class="search-engine-options" role="radiogroup" :aria-label="t('settings.search.heading')">
      <button
        v-for="engine in SEARCH_ENGINE_OPTIONS"
        :key="engine.id"
        class="search-engine-option"
        :class="{ selected: settings.searchEngine === engine.id }"
        type="button"
        role="radio"
        :aria-checked="settings.searchEngine === engine.id"
        :disabled="busy"
        :data-testid="`search-engine-${engine.id}`"
        @click="select(engine.id)"
      >
        <span class="search-engine-mark" aria-hidden="true">{{ engine.label.slice(0, 1) }}</span>
        <span class="search-engine-copy">
          <strong>{{ engine.label }}</strong>
          <small>{{ engine.description }}</small>
          <code>{{ engine.hostname }}</code>
        </span>
        <span class="search-engine-check" aria-hidden="true"><IconCheck /></span>
      </button>
    </div>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.search.privacy') }}</p>
    </div>
  </div>
</template>
