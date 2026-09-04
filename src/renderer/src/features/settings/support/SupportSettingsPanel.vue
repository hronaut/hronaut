<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconFavorite from '~icons/material-symbols/favorite-rounded'
import { UiButton, UiField, UiInput, UiNotice } from '../../../ui/index.js'
import type { CommercialLicenseController } from './useCommercialLicenseController.js'

const props = defineProps<{
  controller: CommercialLicenseController
  formatNumber: (value: number) => string
  formatDateTime: (value: string) => string
}>()
const emit = defineEmits<{
  openUrl: [url: string]
  purchase: []
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  state,
  keyDraft,
  action,
  busy,
  errorMessage,
  stateMessage,
  activate,
  refresh,
  deactivate
} = props.controller
</script>

<template>
  <div class="settings-content support-settings" :aria-busy="busy">
    <div class="setting-copy">
      <span class="support-kicker">{{ t('settings.support.kicker') }}</span>
      <h3>{{ state.active ? t('settings.support.thanks') : t('settings.support.heading') }}</h3>
      <p>{{ t('settings.support.description') }}</p>
    </div>
    <div v-if="state.active" class="support-card commercial-license-card active">
      <span class="support-heart" aria-hidden="true"><IconCheck /></span>
      <strong>{{ t('settings.support.active', { key: state.maskedKey }) }}</strong>
      <small>
        {{ t('settings.support.activations', { used: state.activations == null ? '—' : formatNumber(state.activations), limit: state.activationLimit == null ? t('settings.support.unlimited') : formatNumber(state.activationLimit) }) }}
        <template v-if="state.lastValidatedAt"> {{ t('settings.support.lastChecked', { time: formatDateTime(state.lastValidatedAt) }) }}</template>
      </small>
      <div class="commercial-license-actions">
        <UiButton :busy="action === 'refreshing'" :disabled="busy" @click="refresh">
          {{ action === 'refreshing' ? t('settings.support.checking') : t('settings.support.check') }}
        </UiButton>
        <UiButton :disabled="busy" @click="emit('openUrl', 'https://www.creem.io/my-orders/login')">
          {{ t('settings.support.manage') }}
        </UiButton>
        <UiButton variant="danger" :busy="action === 'deactivating'" :disabled="busy" @click="deactivate">
          {{ action === 'deactivating' ? t('settings.support.deactivating') : t('settings.support.deactivate') }}
        </UiButton>
      </div>
    </div>
    <div v-else class="support-card commercial-license-card">
      <span class="support-heart" aria-hidden="true"><IconFavorite /></span>
      <strong>{{ t('settings.support.activateDescription') }}</strong>
      <small v-if="state.secureStorageAvailable">{{ t('settings.support.secure') }}</small>
      <small v-else>{{ t('settings.support.unavailable') }}</small>
      <form class="commercial-license-form" @submit.prevent="activate">
        <UiField :label="t('settings.support.key')" for-id="commercial-license-key">
          <UiInput
            v-model="keyDraft"
            type="password"
            autocomplete="off"
            spellcheck="false"
            :placeholder="t('settings.support.placeholder')"
            :disabled="!state.secureStorageAvailable || busy"
          />
        </UiField>
        <UiButton
          class="support-primary"
          type="submit"
          variant="primary"
          :busy="action === 'activating'"
          :disabled="!state.secureStorageAvailable || busy"
        >
          {{ action === 'activating' ? t('settings.support.activating') : t('settings.support.activate') }}
        </UiButton>
      </form>
      <small v-if="stateMessage">{{ stateMessage }}</small>
      <UiNotice v-if="errorMessage" tone="danger" role="alert">{{ errorMessage }}</UiNotice>
      <UiButton @click="emit('purchase')">{{ t('settings.support.support') }}</UiButton>
    </div>
    <div class="support-alternatives">
      <span>{{ t('settings.support.alternatives') }}</span>
      <UiButton size="small" variant="ghost" @click="emit('openUrl', 'https://github.com/hronaut/hronaut/blob/main/LICENSE')">{{ t('settings.support.license') }}</UiButton>
      <UiButton size="small" variant="ghost" @click="emit('openUrl', 'https://github.com/hronaut/hronaut/blob/main/CONTRIBUTING.md')">{{ t('settings.support.contributing') }}</UiButton>
      <UiButton size="small" variant="ghost" @click="emit('openUrl', 'https://github.com/hronaut/hronaut/issues')">{{ t('settings.support.issue') }}</UiButton>
    </div>
  </div>
</template>
