<script setup lang="ts">
import { computed, markRaw, toRaw, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SettingsSection } from '../composables/useSettingsDialogController.js'
import UiButton from '../ui/UiButton.vue'

const props = defineProps<{
  items: Array<{ section: SettingsSection; label: string; description: string; icon: Component }>
}>()
const section = defineModel<SettingsSection>({ required: true })
const { t } = useI18n({ useScope: 'global' })
const matches = computed(() => props.items.map(item => ({ ...item, icon: markRaw(toRaw(item.icon)) })))

function scrollNavigationWithWheel(event: WheelEvent): void {
  if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
  const navigation = event.currentTarget
  if (!(navigation instanceof HTMLElement)) return
  const maximum = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
  if (maximum === 0) return
  let unit = 1
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    const lineHeight = Number.parseFloat(getComputedStyle(navigation).lineHeight)
    unit = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 16
  } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    unit = navigation.clientWidth
  }
  const next = Math.min(maximum, Math.max(0, navigation.scrollLeft + event.deltaY * unit))
  if (next === navigation.scrollLeft) return
  navigation.scrollLeft = next
  event.preventDefault()
}
</script>

<template>
  <div class="settings-navigation">
    <nav id="settings-sections" class="settings-sidebar" :aria-label="t('settings.sections')" @wheel="scrollNavigationWithWheel">
      <UiButton v-for="item in matches" :key="item.section" appearance="application" class="settings-nav-item" :class="{ active: section === item.section }" type="button" :title="item.description" :aria-current="section === item.section ? 'page' : undefined" @click="section = item.section">
        <span class="settings-nav-icon" aria-hidden="true"><component :is="item.icon" /></span>
        <span><strong>{{ item.label }}</strong><small class="ui-visually-hidden">{{ item.description }}</small></span>
      </UiButton>
      <p v-if="!matches.length" class="settings-search-empty" role="status">{{ t('settings.noMatchingSections') }}</p>
    </nav>
  </div>
</template>
