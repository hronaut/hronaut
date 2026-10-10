<script setup lang="ts">
import UiIconButton from "../ui/UiIconButton.vue"
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import { formatNumber } from '../../../shared/format'
import type { SupportedLocale } from '../../../shared/types'
import IconKey from '~icons/material-symbols/key-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import CredentialImportCard from './CredentialImportCard.vue'
import type { CredentialsController } from '../composables/useCredentialsController'

const props = defineProps<{
  controller: CredentialsController
}>()

const { t, locale } = useI18n({ useScope: 'global' })
const {
  entries,
  storage,
  errorMessage,
  importFromCsv,
  isPending,
  remove
} = props.controller
const search = ref('')
const filteredEntries = computed(() => {
  const terms = search.value.toLocaleLowerCase(locale.value).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return entries.value
  return entries.value.filter(entry => {
    const text = [entry.username || t('credentialPicker.unnamed'), entry.origin].join('\n').toLocaleLowerCase(locale.value)
    return terms.every(term => text.includes(term))
  })
})
const localNumber = (value: number): string => formatNumber(locale.value as SupportedLocale, value)
const panelRoot = ref<HTMLElement | null>(null)
watch(() => filteredEntries.value.map(entry => entry.id).join('\n'), async (_current, _previous, onCleanup) => {
  const panel = panelRoot.value
  const focused = document.activeElement
  if (!panel || !(focused instanceof HTMLButtonElement) || !panel.contains(focused)
    || !focused.matches('button.credential-remove')) return
  const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button.credential-remove'))
  const index = buttons.indexOf(focused)
  const candidates = [...buttons.slice(index + 1), ...buttons.slice(0, index).reverse()]
  let superseded = false
  onCleanup(() => { superseded = true })
  await nextTick()
  if (superseded || panelRoot.value !== panel || !panel.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  if (focused.isConnected) {
    if (!focused.matches(':disabled')) focused.focus()
    return
  }
  const target = candidates.find(candidate => candidate.isConnected
    && !candidate.matches(':disabled, [aria-disabled="true"]'))
    ?? panel.querySelector<HTMLElement>('#saved-passwords-heading')
  target?.focus()
}, { flush: 'pre' })
</script>

<template>
  <div ref="panelRoot" class="settings-content credentials-settings">
    <div class="setting-copy">
      <h3 id="saved-passwords-heading" tabindex="-1">{{ t('settings.passwords.heading') }}</h3>
      <p>{{ t('settings.passwords.description') }}</p>
    </div>
    <div v-if="!storage.available" class="settings-info security-warning">
      <span class="info-dot" aria-hidden="true"><IconWarning /></span>
      <p>{{ storage.reason }}</p>
    </div>
    <CredentialImportCard v-if="storage.available" :import-from-csv="importFromCsv" />
    <template v-if="storage.available">
      <label class="settings-search credential-search">
        <IconSearch aria-hidden="true" />
        <input v-model="search" type="search" :aria-label="t('settings.passwords.search')" :placeholder="t('settings.passwords.search')" maxlength="256" autocomplete="off" spellcheck="false" />
      </label>
      <p class="permission-search-summary" role="status">{{ t('settings.passwords.searchSummary', { visible: localNumber(filteredEntries.length), total: localNumber(entries.length) }) }}</p>
    </template>
    <div v-if="storage.available && !entries.length" class="site-permissions-empty">
      <span class="empty-permission-icon" aria-hidden="true"><IconKey /></span>
      <strong>{{ t('settings.passwords.emptyHeading') }}</strong>
      <p>{{ t('settings.passwords.emptyDescription') }}</p>
    </div>
    <p v-else-if="storage.available && !filteredEntries.length" class="settings-search-empty">{{ t('settings.passwords.noMatches') }}</p>
    <div v-else-if="storage.available" class="permission-sites">
      <section v-for="credential in filteredEntries" :key="credential.id" class="permission-site">
        <div class="credential-row">
          <span class="permission-name">
            <strong>{{ credential.username || t('credentialPicker.unnamed') }}</strong>
            <small>{{ credential.origin }}</small>
          </span>
          <UiIconButton variant="danger"
            class="permission-remove credential-remove"
            type="button"
            :label="t('settings.passwords.removeAria', { username: credential.username || t('settings.passwords.unnamed'), origin: credential.origin })"
            :title="t('settings.passwords.remove')"
            :aria-disabled="isPending(credential.id)"
            @click="remove(credential.id)"
          >
            <IconDelete aria-hidden="true" />
          </UiIconButton>
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
