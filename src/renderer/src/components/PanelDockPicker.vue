<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { PanelDock } from '../../../shared/types'

defineProps<{
  label: string
}>()

const model = defineModel<PanelDock>({ required: true })
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <label class="panel-dock-picker">
    <span>{{ t('panels.dock') }}</span>
    <select v-model="model" :aria-label="label">
      <option value="right">{{ t('panels.right') }}</option>
      <option value="left">{{ t('panels.left') }}</option>
      <option value="bottom">{{ t('panels.bottom') }}</option>
      <option value="top">{{ t('panels.top') }}</option>
      <option value="window">{{ t('panels.separateWindow') }}</option>
    </select>
  </label>
</template>
