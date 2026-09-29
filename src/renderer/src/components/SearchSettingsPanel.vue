<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import { SEARCH_ENGINE_OPTIONS, isSearchEngineName } from '../../../shared/search-engine.js'
import type { SearchSettingsController } from '../composables/useSearchSettingsController.js'

const props = defineProps<{
  controller: SearchSettingsController
}>()

const { t } = useI18n({ useScope: 'global' })
const { settings, busy, select } = props.controller

function navigateEngine(event: KeyboardEvent): void {
  const current = event.currentTarget
  if (!(current instanceof HTMLButtonElement)) return
  const radios = [...(current.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[data-engine]') ?? [])]
  const index = radios.indexOf(current)
  if (index < 0 || !radios.length) return
  let targetIndex: number
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (index + 1) % radios.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (index - 1 + radios.length) % radios.length
  else if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = radios.length - 1
  else return
  event.preventDefault()
  if (busy.value) return
  const target = radios[targetIndex]
  const engine = target?.dataset.engine
  if (!target || !isSearchEngineName(engine)) return
  target.focus()
  void select(engine)
}
</script>

<template>
  <div class="settings-content">
    <div class="setting-copy">
      <h3>{{ t('settings.search.heading') }}</h3>
      <p>{{ t('settings.search.description') }}</p>
    </div>
    <div class="search-engine-options" role="radiogroup" :aria-label="t('settings.search.heading')">
      <UiButton appearance="application"
        v-for="engine in SEARCH_ENGINE_OPTIONS"
        :key="engine.id"
        class="search-engine-option"
        :class="{ selected: settings.searchEngine === engine.id }"
        type="button"
        role="radio"
        :aria-checked="settings.searchEngine === engine.id"
        :aria-disabled="busy || undefined"
        :tabindex="settings.searchEngine === engine.id ? 0 : -1"
        :data-engine="engine.id"
        :data-testid="`search-engine-${engine.id}`"
        @click="select(engine.id)"
        @keydown="navigateEngine"
      >
        <span class="search-engine-mark" aria-hidden="true">{{ engine.label.slice(0, 1) }}</span>
        <span class="search-engine-copy">
          <strong>{{ engine.label }}</strong>
          <small>{{ engine.description }}</small>
          <code>{{ engine.hostname }}</code>
        </span>
        <span class="search-engine-check" aria-hidden="true"><IconCheck /></span>
      </UiButton>
    </div>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.search.privacy') }}</p>
    </div>
  </div>
</template>
