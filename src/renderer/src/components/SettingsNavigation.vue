<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import IconSearch from '~icons/material-symbols/search-rounded'
import type { SettingsSection } from '../composables/useSettingsDialogController.js'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  items: Array<{ section: SettingsSection; label: string; description: string; icon: Component }>
}>()
const section = defineModel<SettingsSection>({ required: true })
const { t, locale } = useI18n({ useScope: 'global' })
const query = ref('')
const matches = computed(() => {
  const words = query.value.trim().toLocaleLowerCase(locale.value).split(/\s+/)
  return props.items.filter(item => words.every(word => `${item.label} ${item.description}`.toLocaleLowerCase(locale.value).includes(word)))
})

function searchKeydown(event: KeyboardEvent): void {
  if (event.isComposing) return
  if (event.key === 'Escape' && query.value) {
    event.stopPropagation()
    query.value = ''
  } else if (event.key === 'Enter' && matches.value[0]) {
    event.preventDefault()
    section.value = matches.value[0].section
  }
}

function scrollNavigationWithWheel(event: WheelEvent): void {
  if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  const navigation = event.currentTarget
  if (!(navigation instanceof HTMLElement)) return
  const maximum = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
  if (maximum === 0) return
  const next = Math.min(maximum, Math.max(0, navigation.scrollLeft + event.deltaY))
  if (next === navigation.scrollLeft) return
  navigation.scrollLeft = next
  event.preventDefault()
}
</script>

<template>
  <div class="settings-navigation">
    <label class="settings-search">
      <IconSearch aria-hidden="true" />
      <input v-model="query" type="search" :aria-label="t('settings.searchSections')" :placeholder="t('settings.searchSections')" autocomplete="off" aria-controls="settings-sections" @keydown="searchKeydown">
    </label>
    <nav id="settings-sections" class="settings-sidebar" :aria-label="t('settings.sections')" @wheel="scrollNavigationWithWheel">
      <UiButton v-for="item in matches" :key="item.section" appearance="application" class="settings-nav-item" :class="{ active: section === item.section }" type="button" :title="item.description" :aria-current="section === item.section ? 'page' : undefined" @click="section = item.section">
        <span class="settings-nav-icon" aria-hidden="true"><component :is="item.icon" /></span>
        <span><strong>{{ item.label }}</strong><small class="ui-visually-hidden">{{ item.description }}</small></span>
      </UiButton>
      <p v-if="!matches.length" class="settings-search-empty" role="status">{{ t('settings.noMatchingSections') }}</p>
    </nav>
  </div>
</template>
