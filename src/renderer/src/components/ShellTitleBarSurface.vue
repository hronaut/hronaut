<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import appIcon from '../../../../build/icons/64x64.png'
import IconSettings from '~icons/material-symbols/settings-rounded'

defineProps<{
  kind: 'rail' | 'home' | 'settings'
  draggable: boolean
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div
    class="shell-title-bar-surface"
    :class="`surface-${kind}`"
    :data-titlebar-drag-surface="draggable ? '' : undefined"
    aria-hidden="true"
  >
    <!-- Home carries the app's own mark: it is Hronaut's page, so Home itself names no brand. -->
    <span class="shell-title-bar-mark" :class="{ 'app-brand': kind !== 'settings' }"><IconSettings v-if="kind === 'settings'" /><img v-else :src="appIcon" alt="" draggable="false" /></span>
    <strong>{{ kind === 'settings' ? t('settings.heading') : kind === 'home' ? t('shell.home.label') : t('common.hronaut') }}</strong>
  </div>
</template>
