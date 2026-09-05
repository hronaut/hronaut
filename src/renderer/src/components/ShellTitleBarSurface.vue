<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import appIcon from '../../../../build/icons/64x64.png'
import IconDashboard from '~icons/material-symbols/dashboard-rounded'

defineProps<{
  kind: 'rail' | 'home'
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
    <span class="shell-title-bar-mark" :class="{ 'app-brand': kind === 'rail' }"><img v-if="kind === 'rail'" :src="appIcon" alt="" draggable="false" /><IconDashboard v-else /></span>
    <strong>{{ kind === 'home' ? t('shell.home.label') : t('common.hronaut') }}</strong>
  </div>
</template>
