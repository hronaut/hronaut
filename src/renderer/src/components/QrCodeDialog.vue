<script setup lang="ts">
import UiButton from '../ui/UiButton.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import UiOverlayTransition from '../ui/UiOverlayTransition.vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import { ignoreHeldEnter } from '../held-enter.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'
import type { QrCodeDialogController } from '../composables/useQrCodeDialogController.js'
import { qrCodePath, QR_CODE_QUIET_ZONE } from '../../../shared/qr-code-path.js'

/** Chrome's dialog asks for no more characters than this, a round number under what the largest code holds. */
const CHARACTER_LIMIT = 2000

const props = defineProps<{
  controller: QrCodeDialogController
  formatNumber: (value: number) => string
  reportLayout: () => void
}>()

const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const field = ref<HTMLInputElement | null>(null)
const { open, text, modules, tooLong, status, error, close, copy, download } = props.controller
const path = computed(() => (modules.value ? qrCodePath(modules.value) : ''))
const box = computed(() => {
  const size = (modules.value?.length ?? 0) + QR_CODE_QUIET_ZONE * 2
  return `${-QR_CODE_QUIET_ZONE} ${-QR_CODE_QUIET_ZONE} ${size} ${size}`
})

// As in Chrome, the address takes the focus, so the person can edit it right away.
useModalDialogFocus({ open, panel, focusTarget: field, afterLayout: props.reportLayout })
</script>

<template>
  <UiOverlayTransition>
    <div v-if="open" class="settings-overlay qr-code-overlay" @click.self="close">
      <section ref="panel" class="qr-code-dialog" role="dialog" aria-modal="true" aria-labelledby="qr-code-title" tabindex="-1">
        <header class="qr-code-header">
          <h2 id="qr-code-title">{{ t('qrCode.title') }}</h2>
          <UiIconButton class="panel-close" :label="t('qrCode.close')" @click="close"><IconClose aria-hidden="true" /></UiIconButton>
        </header>
        <div class="qr-code-image">
          <svg v-if="modules" role="img" :aria-label="t('qrCode.image')" :viewBox="box" shape-rendering="crispEdges">
            <path :d="path" />
          </svg>
        </div>
        <input
          ref="field"
          v-model="text"
          class="ui-control ui-input qr-code-text"
          type="text"
          spellcheck="false"
          autocomplete="off"
          :aria-label="t('qrCode.url')"
          :aria-invalid="tooLong"
          :aria-describedby="tooLong ? 'qr-code-too-long' : 'qr-code-hint'"
        >
        <p v-if="tooLong" id="qr-code-too-long" class="qr-code-error">{{ t('qrCode.tooLong', { count: formatNumber(CHARACTER_LIMIT) }) }}</p>
        <p v-else-if="error" class="qr-code-error" role="alert">{{ error }}</p>
        <p id="qr-code-hint" class="qr-code-hint">{{ t('qrCode.hint') }}</p>
        <p class="sr-only" role="status">{{ status === 'copied' ? t('qrCode.copied') : status === 'downloaded' ? t('qrCode.downloaded') : '' }}</p>
        <footer class="qr-code-actions">
          <UiButton :disabled="!modules" @keydown="ignoreHeldEnter" @click="copy">{{ t('qrCode.copy') }}</UiButton>
          <UiButton variant="primary" :disabled="!modules" @keydown="ignoreHeldEnter" @click="download">{{ t('qrCode.download') }}</UiButton>
        </footer>
      </section>
    </div>
  </UiOverlayTransition>
</template>
