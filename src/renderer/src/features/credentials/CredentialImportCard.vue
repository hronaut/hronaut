<script setup lang="ts">
import UiButton from "../../ui/UiButton.vue"
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import type { CredentialImportResult } from '../../../../shared/types.js'
import { friendlyUiError } from '../../composables/useAppToastController.js'

const props = defineProps<{
  importFromCsv: () => Promise<CredentialImportResult>
}>()

const { t } = useI18n({ useScope: 'global' })
const state = ref<'idle' | 'importing' | 'imported' | 'error'>('idle')
const message = ref('')

async function importCredentials(event: Event): Promise<void> {
  if (state.value === 'importing') return
  const button = event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget
    ? event.currentTarget : null
  await importFromFile()
  // The button is disabled while the native chooser and the import run, so Chromium moves its focus to the document
  // body. Give it back once the button is enabled again, unless you moved it meanwhile or left this section.
  await nextTick()
  if (!button?.isConnected || button.matches(':disabled') || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== button) return
  button.focus()
}

async function importFromFile(): Promise<void> {
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
    message.value = friendlyUiError(error, t('runtime.toast.actionFailed'))
  }
}
</script>

<template>
  <section class="credential-import-card" aria-labelledby="credential-import-title">
    <div>
      <h4 id="credential-import-title">{{ t('settings.passwords.importHeading') }}</h4>
      <p>{{ t('settings.passwords.importDescription') }}</p>
    </div>
    <UiButton class="secondary-button" type="button" :disabled="state === 'importing'" @click="importCredentials">
      <IconProgress v-if="state === 'importing'" class="state-spinner" aria-hidden="true" />
      <IconDownload v-else aria-hidden="true" />
      {{ state === 'importing' ? t('settings.passwords.importing') : t('settings.passwords.importButton') }}
    </UiButton>
    <output v-if="message" class="credential-import-status" :class="state" aria-live="polite">{{ message }}</output>
    <p class="credential-import-warning"><IconWarning aria-hidden="true" /> {{ t('settings.passwords.importPlaintext') }}</p>
  </section>
</template>
