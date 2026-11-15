<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import UiButton from '../../ui/UiButton.vue'
import UiCheckbox from '../../ui/UiCheckbox.vue'
import UiField from '../../ui/UiField.vue'
import UiInput from '../../ui/UiInput.vue'
import { isImeCompositionEvent } from '../../keyboard-composition.js'
import {
  SECURE_DNS_PROVIDERS,
  SECURE_DNS_TEMPLATE_MAX_LENGTH,
  isSecureDnsTemplate,
  type SecureDnsMode
} from '../../../../shared/secure-dns.js'
import { useSettingsStore } from '../../stores/settings.js'

/**
 * Settings' Use secure DNS, as in Chrome's Settings > Privacy and security > Security: while it is on, website
 * addresses are looked up over an encrypted connection, through the DNS service's own secure DNS when it offers one,
 * or through one chosen provider only. Main applies each change to Chromium's host resolver before saving it.
 */
const emit = defineEmits<{
  settingError: [error: unknown]
}>()

const { t } = useI18n({ useScope: 'global' })
const store = useSettingsStore()
const { settings } = storeToRefs(store)
const ids = useId()
const headingId = `secure-dns-heading-${ids}`
const switchId = `secure-dns-switch-${ids}`
const providerId = `secure-dns-provider-${ids}`

const customForm = ref<HTMLFormElement | null>(null)
// Whether Custom was picked in the list, so the list shows Custom before a custom address is in use.
const editingCustom = ref(false)
// Whether Use was pressed, after which the field says when the address is not one a provider can have.
const attempted = ref(false)

function knownProvider(template: string): string | undefined {
  return SECURE_DNS_PROVIDERS.find((provider) => provider.template === template)?.id
}

// The custom address used last, filled in again when Custom is picked after a listed provider.
let lastCustomTemplate = knownProvider(settings.value.secureDnsTemplate) ? '' : settings.value.secureDnsTemplate

const customTemplate = ref(lastCustomTemplate)
const enabled = computed(() => settings.value.secureDnsMode !== 'off')
const choice = computed(() => {
  if (editingCustom.value) return 'custom'
  if (settings.value.secureDnsMode !== 'secure') return 'automatic'
  return knownProvider(settings.value.secureDnsTemplate) ?? 'custom'
})
// Whether the field holds an address other than the one in use, which Use has yet to apply.
const customPending = computed(() => settings.value.secureDnsMode !== 'secure'
  || customTemplate.value.trim() !== settings.value.secureDnsTemplate)
const customError = computed(() => attempted.value && !isSecureDnsTemplate(customTemplate.value)
  ? t('settings.privacy.secureDns.customInvalid')
  : undefined)

async function change(mode: SecureDnsMode, template: string): Promise<boolean> {
  try {
    await store.setSecureDns(mode, template)
    return true
  } catch (error) {
    emit('settingError', error)
    return false
  }
}

async function changeEnabled(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  editingCustom.value = false
  attempted.value = false
  // Turned on, it starts with the DNS service's own secure DNS, as Chrome does.
  if (!(await change(input.checked ? 'automatic' : 'off', settings.value.secureDnsTemplate))) input.checked = enabled.value
}

async function changeProvider(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement
  attempted.value = false
  // The field follows the list; the keyboard stays on the list, whose arrow keys change the choice.
  if (select.value === 'custom') {
    editingCustom.value = true
    customTemplate.value = lastCustomTemplate
    return
  }
  editingCustom.value = false
  const provider = SECURE_DNS_PROVIDERS.find((candidate) => candidate.id === select.value)
  const changed = provider
    ? await change('secure', provider.template)
    : await change('automatic', settings.value.secureDnsTemplate)
  if (!changed) select.value = choice.value
}

async function useCustom(): Promise<void> {
  const submitted = customTemplate.value
  attempted.value = true
  if (!isSecureDnsTemplate(submitted)) {
    await nextTick()
    customForm.value?.querySelector<HTMLInputElement>('input')?.focus()
    return
  }
  if (!(await change('secure', submitted.trim()))) return
  lastCustomTemplate = submitted.trim()
  // An address typed while this one was saved stays as typed, with its own check.
  if (customTemplate.value !== submitted) return
  customTemplate.value = lastCustomTemplate
  editingCustom.value = false
  attempted.value = false
}

function formKeydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event)) return
  // A held Enter uses the address once, not again with every repeat.
  if (event.key === 'Enter' && event.repeat) event.preventDefault()
}
</script>

<template>
  <section class="secure-dns-settings" :aria-labelledby="headingId">
    <div class="setting-copy">
      <h4 :id="headingId">{{ t('settings.privacy.secureDns.heading') }}</h4>
      <p>{{ t('settings.privacy.secureDns.description') }}</p>
    </div>
    <div class="settings-rows">
      <label class="settings-row" :for="switchId">
        <span>
          <strong>{{ t('settings.privacy.secureDns.use') }}</strong>
          <small>{{ t('settings.privacy.secureDns.useDescription') }}</small>
        </span>
        <UiCheckbox
          :id="switchId"
          bare
          appearance="switch"
          :checked="enabled"
          @change="changeEnabled"
        />
      </label>
      <label v-if="enabled" class="settings-row" :for="providerId">
        <span>
          <strong>{{ t('settings.privacy.secureDns.provider') }}</strong>
          <small>{{ choice === 'automatic' ? t('settings.privacy.secureDns.automaticDescription') : t('settings.privacy.secureDns.chosenDescription') }}</small>
        </span>
        <select :id="providerId" :value="choice" @change="changeProvider">
          <option value="automatic">{{ t('settings.privacy.secureDns.automatic') }}</option>
          <option v-for="provider in SECURE_DNS_PROVIDERS" :key="provider.id" :value="provider.id">{{ provider.label }}</option>
          <option value="custom">{{ t('settings.privacy.secureDns.custom') }}</option>
        </select>
      </label>
    </div>
    <form
      v-if="enabled && choice === 'custom'"
      ref="customForm"
      class="secure-dns-custom"
      novalidate
      @submit.prevent="useCustom"
      @keydown="formKeydown"
    >
      <UiField
        :label="t('settings.privacy.secureDns.customLabel')"
        :hint="customPending ? t('settings.privacy.secureDns.customPending') : t('settings.privacy.secureDns.customHint')"
        :error="customError"
      >
        <UiInput
          v-model="customTemplate"
          type="url"
          :maxlength="SECURE_DNS_TEMPLATE_MAX_LENGTH"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
        />
      </UiField>
      <UiButton variant="primary" type="submit">{{ t('settings.privacy.secureDns.useCustom') }}</UiButton>
    </form>
  </section>
</template>
