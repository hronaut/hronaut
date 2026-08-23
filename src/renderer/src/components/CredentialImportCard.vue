<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import type { CredentialImportResult } from '../../../shared/types.js'

const props = defineProps<{
  importFromCsv: () => Promise<CredentialImportResult>
}>()

const { t } = useI18n({ useScope: 'global' })
const state = ref<'idle' | 'importing' | 'imported' | 'error'>('idle')
const message = ref('')

async function importCredentials(): Promise<void> {
  if (state.value === 'importing') return
  state.value = 'importing'
  message.value = ''
  try {
    const result = await props.importFromCsv()
    if (result.canceled) {
      state.value = 'idle'
      return
    }
    state.value = 'imported'
    message.value = t('settings.passwords.imported', {
      added: result.added,
      updated: result.updated,
      skipped: result.skipped
    })
  } catch (error) {
    state.value = 'error'
    message.value = error instanceof Error ? error.message : t('runtime.toast.actionFailed')
  }
}
</script>

<template>
  <section class="credential-import-card" aria-labelledby="credential-import-title">
    <div>
      <h4 id="credential-import-title">{{ t('settings.passwords.importHeading') }}</h4>
      <p>{{ t('settings.passwords.importDescription') }}</p>
    </div>
    <button class="secondary-button" type="button" :disabled="state === 'importing'" @click="importCredentials">
      <IconProgress v-if="state === 'importing'" class="state-spinner" aria-hidden="true" />
      <IconDownload v-else aria-hidden="true" />
      {{ state === 'importing' ? t('settings.passwords.importing') : t('settings.passwords.importButton') }}
    </button>
    <output v-if="message" class="credential-import-status" :class="state" aria-live="polite">{{ message }}</output>
    <p class="credential-import-warning"><IconWarning aria-hidden="true" /> {{ t('settings.passwords.importPlaintext') }}</p>
  </section>
</template>
