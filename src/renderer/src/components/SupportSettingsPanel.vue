<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconFavorite from '~icons/material-symbols/favorite-rounded'
import type { CommercialLicenseController } from '../composables/useCommercialLicenseController'

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
        <button class="secondary-button" type="button" :disabled="busy" @click="refresh">
          {{ action === 'refreshing' ? t('settings.support.checking') : t('settings.support.check') }}
        </button>
        <button class="secondary-button" type="button" :disabled="busy" @click="emit('openUrl', 'https://www.creem.io/my-orders/login')">
          {{ t('settings.support.manage') }}
        </button>
        <button class="secondary-button danger" type="button" :disabled="busy" @click="deactivate">
          {{ action === 'deactivating' ? t('settings.support.deactivating') : t('settings.support.deactivate') }}
        </button>
      </div>
    </div>
    <div v-else class="support-card commercial-license-card">
      <span class="support-heart" aria-hidden="true"><IconFavorite /></span>
      <strong>{{ t('settings.support.activateDescription') }}</strong>
      <small v-if="state.secureStorageAvailable">{{ t('settings.support.secure') }}</small>
      <small v-else>{{ t('settings.support.unavailable') }}</small>
      <form class="commercial-license-form" @submit.prevent="activate">
        <label for="commercial-license-key">{{ t('settings.support.key') }}</label>
        <input
          id="commercial-license-key"
          v-model="keyDraft"
          type="password"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('settings.support.placeholder')"
          :disabled="!state.secureStorageAvailable || busy"
        />
        <button class="primary-button support-primary" type="submit" :disabled="!state.secureStorageAvailable || busy">
          {{ action === 'activating' ? t('settings.support.activating') : t('settings.support.activate') }}
        </button>
      </form>
      <small v-if="stateMessage">{{ stateMessage }}</small>
      <small v-if="errorMessage" class="commercial-license-error" role="alert">{{ errorMessage }}</small>
      <button class="secondary-button" type="button" @click="emit('purchase')">{{ t('settings.support.support') }}</button>
    </div>
    <div class="support-alternatives">
      <span>{{ t('settings.support.alternatives') }}</span>
      <button type="button" @click="emit('openUrl', 'https://github.com/hronaut/hronaut/blob/main/LICENSE')">{{ t('settings.support.license') }}</button>
      <button type="button" @click="emit('openUrl', 'https://github.com/hronaut/hronaut/blob/main/CONTRIBUTING.md')">{{ t('settings.support.contributing') }}</button>
      <button type="button" @click="emit('openUrl', 'https://github.com/hronaut/hronaut/issues')">{{ t('settings.support.issue') }}</button>
    </div>
  </div>
</template>
