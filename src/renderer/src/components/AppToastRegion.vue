<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
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
      <UiButton appearance="application" type="button" :aria-label="t('panels.dismiss', { title: toast.title })" @click="$emit('dismiss', toast.id)"><IconClose aria-hidden="true" /></UiButton>
    </article>
  </TransitionGroup>
</template>

<style scoped>
.app-toast-region {
  position: fixed;
  z-index: 500;
  top: 4px;
  left: 50%;
  display: grid;
  width: min(620px, calc(100vw - 280px));
  transform: translateX(-50%);
  pointer-events: none;
}
.app-toast {
  display: grid;
  min-height: 36px;
  max-height: 36px;
  grid-template-columns: 24px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 9px;
  color: var(--text);
  background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  box-shadow: 0 12px 34px rgba(0, 0, 0, .28);
  backdrop-filter: blur(14px);
  pointer-events: auto;
}
.app-toast.error { border-color: color-mix(in srgb, var(--danger) 54%, var(--border)); }
.app-toast.success { border-color: color-mix(in srgb, var(--success) 48%, var(--border)); }
.app-toast.info { border-color: color-mix(in srgb, var(--accent) 48%, var(--border)); }
.app-toast-mark {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 7px;
  color: var(--accent);
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.app-toast.error .app-toast-mark { color: var(--danger); }
.app-toast.success .app-toast-mark { color: var(--success); }
.app-toast-mark svg { width: 15px; height: 15px; }
.app-toast-copy { display: flex; min-width: 0; align-items: baseline; gap: 7px; }
.app-toast-copy strong { flex: 0 0 auto; font-size: 12px; line-height: 1.2; }
.app-toast-copy > span { min-width: 0; overflow: hidden; color: var(--muted); font-size: 12px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.app-toast > button {
  display: grid;
  width: 24px;
  height: 24px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 7px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}
.app-toast > button:hover { color: var(--text); background: var(--hover); }
.app-toast > button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.app-toast > button svg { width: 14px; height: 14px; }
.app-toast-enter-active,
.app-toast-leave-active { transition: opacity 140ms ease, transform 140ms ease; }
.app-toast-enter-from,
.app-toast-leave-to { opacity: 0; transform: translateY(-6px); }

@media (max-width: 760px) {
  .app-toast-region { width: calc(100vw - 16px); }
}
</style>
