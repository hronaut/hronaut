<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import type { PanelDock } from '../../../shared/types.js'
import PanelDockPicker from './PanelDockPicker.vue'

defineProps<{ label: string }>()
const dock = defineModel<PanelDock>('dock', { required: true })
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <div
    class="detached-panel-unavailable-state"
    role="dialog"
    aria-modal="false"
    :aria-label="label"
  >
    <header>
      <span>
        <small>{{ t('panels.websiteRequired') }}</small>
        <strong>{{ label }}</strong>
      </span>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockPanel')" />
        <UiButton native class="panel-close" type="button" :aria-label="t('panels.closePanel', { panel: label })" @click="emit('close')"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div>
      <span aria-hidden="true"><IconLanguage /></span>
      <h2>{{ t('panels.openWebsite') }}</h2>
      <p>{{ t('panels.openWebsiteDescription') }}</p>
    </div>
  </div>
</template>
