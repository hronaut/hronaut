<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconChevronRight from '~icons/material-symbols/chevron-right-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import type { AppUpdateState } from '../../../shared/types'
import { formatReleaseNotes } from '../release-notes'

const props = withDefaults(defineProps<{ state: AppUpdateState; mode?: 'pill' | 'panel'; disabled?: boolean }>(), {
  mode: 'pill',
  disabled: false
})
const emit = defineEmits<{
  open: []
  check: []
  download: []
  install: []
}>()
const { t } = useI18n({ useScope: 'global' })

const title = computed(() => {
  switch (props.state.status) {
    case 'checking': return t('updates.status.checking')
    case 'available': return t('updates.status.available', { version: props.state.availableVersion ?? '' })
    case 'downloading': return t('updates.status.downloading')
    case 'downloaded': return t('updates.status.downloaded')
    case 'installing': return t('updates.status.installing')
    case 'up-to-date': return t('updates.status.current')
    case 'error':
    case 'install-error': return t('updates.status.attention')
    case 'disabled': return t('updates.status.unavailable')
    default: return t('updates.status.default')
  }
})

const description = computed(() => {
  switch (props.state.status) {
    case 'checking': return t('updates.description.checking')
    case 'available': return t('updates.description.available', { version: props.state.availableVersion ?? '' })
    case 'downloading': return t('updates.description.downloading', { version: props.state.availableVersion ?? '' })
    case 'downloaded': return t('updates.description.downloaded', { version: props.state.availableVersion ?? '' })
    case 'installing': return props.state.message || t('updates.description.installing')
    case 'up-to-date': return t('updates.description.current', { version: props.state.currentVersion })
    case 'error':
    case 'install-error': return props.state.message || t('updates.description.failed')
    case 'disabled': return props.state.message || t('updates.description.unavailable')
    default: return t('updates.description.version', { version: props.state.currentVersion })
  }
})

const busy = computed(() => props.state.status === 'checking' || props.state.status === 'downloading' || props.state.status === 'installing')
const formattedReleaseNotes = computed(() => props.state.releaseNotes ? formatReleaseNotes(props.state.releaseNotes) : '')

const pillLabel = computed(() => {
  switch (props.state.status) {
    case 'available': return t('updates.pill.available', { version: props.state.availableVersion ?? '' })
    case 'downloading': return t('updates.pill.downloading', { percent: Math.round(props.state.percent ?? 0) })
    case 'downloaded': return t('updates.pill.downloaded')
    case 'installing': return t('updates.pill.installing')
    case 'up-to-date': return t('updates.pill.current')
    case 'error':
    case 'install-error': return t('updates.pill.attention')
    case 'disabled': return t('updates.pill.unavailable')
    default: return t('updates.pill.checking')
  }
})
</script>

<template>
  <UiButton native
    v-if="mode === 'pill'"
    class="update-status-pill"
    :class="state.status"
    type="button"
    aria-live="polite"
    :aria-label="t('updates.open', { status: pillLabel })"
    :title="t('updates.openTitle')"
    @click="emit('open')"
  >
    <span class="update-status-icon" :class="{ busy, error: state.status === 'error' || state.status === 'install-error' }" aria-hidden="true">
      <IconCheck v-if="state.status === 'up-to-date'" />
      <IconDownload v-else-if="state.status === 'available'" />
      <IconRefresh v-else-if="state.status === 'downloaded'" />
      <IconError v-else-if="state.status === 'error' || state.status === 'install-error'" />
      <IconInfo v-else-if="state.status === 'disabled'" />
    </span>
    <span class="update-status-label">{{ pillLabel }}</span>
    <IconChevronRight class="update-status-chevron" aria-hidden="true" />
  </UiButton>

  <section v-else class="update-status-card" :class="state.status" aria-live="polite" :aria-label="t('updates.cardLabel')">
    <div class="update-status-card-heading">
      <span class="update-status-card-icon" :class="{ busy, error: state.status === 'error' || state.status === 'install-error' }" aria-hidden="true">
        <IconCheck v-if="state.status === 'up-to-date'" />
        <IconDownload v-else-if="state.status === 'available'" />
        <IconRefresh v-else-if="state.status === 'downloaded'" />
        <IconError v-else-if="state.status === 'error' || state.status === 'install-error'" />
        <IconInfo v-else-if="state.status === 'disabled'" />
      </span>
      <div>
        <strong>{{ title }}</strong>
        <p>{{ description }}</p>
      </div>
    </div>
    <div v-if="state.status === 'downloading'" class="update-progress" :aria-label="t('updates.progress')">
      <span :style="{ width: `${Math.min(100, Math.max(0, state.percent ?? 0))}%` }" />
    </div>
    <div
      v-if="formattedReleaseNotes && (state.status === 'available' || state.status === 'downloaded')"
      class="release-notes"
      :aria-label="t('updates.releaseNotes')"
      v-html="formattedReleaseNotes"
    />
    <div class="update-status-card-actions">
      <UiButton native
        v-if="state.status === 'up-to-date' || state.status === 'disabled' || state.status === 'error'"
        class="secondary-button"
        type="button"
        :disabled="disabled"
        @click="emit('check')"
      >
        {{ state.status === 'error' ? t('common.tryAgain') : t('common.checkAgain') }}
      </UiButton>
      <UiButton native v-if="state.status === 'available'" class="primary-button" type="button" :disabled="disabled" @click="emit('download')">
        {{ t('updates.download') }}
      </UiButton>
      <UiButton native v-if="state.status === 'downloaded'" class="primary-button" type="button" :disabled="disabled" @click="emit('install')">
        {{ t('updates.install') }}
      </UiButton>
      <UiButton native v-if="state.status === 'install-error'" class="primary-button" type="button" :disabled="disabled" @click="emit('install')">
        {{ t('updates.retryInstall') }}
      </UiButton>
    </div>
  </section>
</template>
