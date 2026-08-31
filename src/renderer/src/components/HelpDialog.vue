<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDashboard from '~icons/material-symbols/space-dashboard-rounded'
import type { HelpDialogController } from '../composables/useHelpDialogController.js'
import type { ReleaseHistoryController } from '../composables/useReleaseHistoryController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'

const props = defineProps<{
  controller: HelpDialogController
  currentVersion: string
  openUrl: (url: string) => Promise<void>
  openSupportSettings: () => void
  releaseHistoryController: ReleaseHistoryController
  reportLayout: () => void
}>()

const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const { dialog, open, shortcuts, close } = props.controller

useModalDialogFocus({
  open,
  panel,
  afterLayout: props.reportLayout
})
</script>

<template>
  <div v-if="dialog" class="settings-overlay help-overlay" @click.self="close">
    <section
      ref="panel"
      class="help-dialog"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="dialog === 'shortcuts' ? 'shortcuts-title' : 'about-title'"
      tabindex="-1"
    >
      <header class="help-dialog-header">
        <div>
          <span class="eyebrow">{{ t('help.kicker') }}</span>
          <h2 v-if="dialog === 'shortcuts'" id="shortcuts-title">{{ t('help.shortcuts') }}</h2>
          <h2 v-else id="about-title">{{ t('help.about') }}</h2>
        </div>
        <button class="panel-close" type="button" :aria-label="t('help.close')" @click="close"><IconClose aria-hidden="true" /></button>
      </header>
      <div v-if="dialog === 'shortcuts'" class="shortcuts-content">
        <p>{{ t('help.shortcutsDescription') }}</p>
        <dl class="shortcut-list">
          <div v-for="shortcut in shortcuts" :key="shortcut.label" class="shortcut-row">
            <dt>{{ shortcut.label }}</dt>
            <dd>
              <kbd v-for="key in shortcut.keys" :key="key">{{ key }}</kbd>
            </dd>
          </div>
        </dl>
      </div>
      <div v-else class="about-content">
        <span class="about-mark" aria-hidden="true"><IconDashboard /></span>
        <div>
          <h3>Hronaut {{ currentVersion || t('help.developmentBuild') }}</h3>
          <p>{{ t('help.description') }}</p>
        </div>
        <div class="about-actions">
          <button class="secondary-button" type="button" @click="releaseHistoryController.openDialog">{{ t('updates.history.view') }}</button>
          <button class="secondary-button" type="button" @click="openUrl('https://github.com/hronaut/hronaut')">{{ t('help.repository') }}</button>
          <button class="secondary-button" type="button" @click="openUrl('https://github.com/hronaut/hronaut/blob/main/LICENSE')">{{ t('help.license') }}</button>
          <button class="secondary-button" type="button" @click="openUrl('https://github.com/hronaut/hronaut/blob/main/CONTRIBUTING.md')">{{ t('help.contribute') }}</button>
          <button class="primary-button" type="button" @click="openSupportSettings">{{ t('help.support') }}</button>
        </div>
      </div>
    </section>
  </div>
</template>
