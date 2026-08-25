<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconKey from '~icons/material-symbols/key-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import CredentialImportCard from './CredentialImportCard.vue'
import type { CredentialsController } from '../composables/useCredentialsController'

const props = defineProps<{
  controller: CredentialsController
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  entries,
  storage,
  errorMessage,
  importFromCsv,
  isPending,
  remove
} = props.controller
</script>

<template>
  <div class="settings-content credentials-settings">
    <div class="setting-copy">
      <h3>{{ t('settings.passwords.heading') }}</h3>
      <p>{{ t('settings.passwords.description') }}</p>
    </div>
    <div v-if="!storage.available" class="settings-info security-warning">
      <span class="info-dot" aria-hidden="true"><IconWarning /></span>
      <p>{{ storage.reason }}</p>
    </div>
    <CredentialImportCard v-if="storage.available" :import-from-csv="importFromCsv" />
    <div v-if="storage.available && !entries.length" class="site-permissions-empty">
      <span class="empty-permission-icon" aria-hidden="true"><IconKey /></span>
      <strong>{{ t('settings.passwords.emptyHeading') }}</strong>
      <p>{{ t('settings.passwords.emptyDescription') }}</p>
    </div>
    <div v-else-if="storage.available" class="permission-sites">
      <section v-for="credential in entries" :key="credential.id" class="permission-site">
        <div class="credential-row">
          <span class="permission-name">
            <strong>{{ credential.username || t('credentialPicker.unnamed') }}</strong>
            <small>{{ credential.origin }}</small>
          </span>
          <button
            class="permission-remove credential-remove"
            type="button"
            :aria-label="t('settings.passwords.removeAria', { username: credential.username || t('settings.passwords.unnamed'), origin: credential.origin })"
            :title="t('settings.passwords.remove')"
            :disabled="isPending(credential.id)"
            @click="remove(credential.id)"
          >
            <IconDelete aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
    <output v-if="errorMessage" class="site-controls-error" role="alert">{{ errorMessage }}</output>
    <div v-if="storage.available" class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.passwords.encryptedBy') }} {{ storage.backend }}. {{ t('settings.passwords.help') }}</p>
    </div>
  </div>
</template>
