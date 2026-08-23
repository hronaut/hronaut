<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import type { AppToast } from '../composables/useAppToastController'

defineProps<{
  toasts: readonly AppToast[]
  home: boolean
}>()

defineEmits<{
  dismiss: [id: number]
}>()

const { t } = useI18n({ useScope: 'global' })
</script>

<template>
  <TransitionGroup
    name="app-toast"
    tag="aside"
    class="app-toast-region"
    :class="{ home }"
    :aria-label="t('panels.notifications')"
  >
    <article
      v-for="toast in toasts"
      :key="toast.id"
      class="app-toast"
      :class="toast.tone"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
      :aria-label="toast.title"
      :title="`${toast.title}: ${toast.message}`"
    >
      <span class="app-toast-mark" aria-hidden="true">
        <IconError v-if="toast.tone === 'error'" />
        <IconCheck v-else-if="toast.tone === 'success'" />
        <IconInfo v-else />
      </span>
      <span class="app-toast-copy"><strong>{{ toast.title }}</strong><span>{{ toast.message }}</span></span>
      <button type="button" :aria-label="t('panels.dismiss', { title: toast.title })" @click="$emit('dismiss', toast.id)"><IconClose aria-hidden="true" /></button>
    </article>
  </TransitionGroup>
</template>
