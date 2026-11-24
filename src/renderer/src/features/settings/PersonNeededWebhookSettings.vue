<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiButton from '../../ui/UiButton.vue'
import UiCheckbox from '../../ui/UiCheckbox.vue'
import UiField from '../../ui/UiField.vue'
import UiInput from '../../ui/UiInput.vue'
import { PERSON_NEEDED_WEBHOOK_KINDS, webhookAddressProblem } from '../../../../shared/person-needed-webhook.js'
import type { PersonNeededWebhookKind, PersonNeededWebhookSettings, PersonNeededWebhookTest } from '../../../../shared/types.js'

/**
 * Settings' Message me elsewhere: when an agent needs the person, Hronaut also posts a message to a Slack or Discord
 * channel, an ntfy topic or the person's own endpoint. It is off until the person turns it on with an address, and it
 * is the one setting here that sends anything off the computer, which the row says.
 */
const emit = defineEmits<{
  settingError: [error: unknown]
}>()

const { t } = useI18n({ useScope: 'global' })
const switchId = 'setting-person-needed-webhook'
const kindId = 'setting-person-needed-webhook-kind'

const saved = ref<PersonNeededWebhookSettings | null>(null)
// Turned on with no address saved yet: the form shows, and Save turns it on.
const opening = ref(false)
const kind = ref<PersonNeededWebhookKind>('json')
const address = ref('')
const attempted = ref(false)
const busy = ref(false)
const tested = ref<PersonNeededWebhookTest | null>(null)
const copied = ref(false)

const shown = computed(() => Boolean(saved.value?.enabled) || opening.value)
const pending = computed(() => !saved.value?.enabled || address.value.trim() !== saved.value.url || kind.value !== saved.value.kind)
const addressError = computed(() => {
  if (!attempted.value) return undefined
  const value = address.value.trim()
  if (!value) return t('appearance.personNeededWebhook.addressMissing')
  return webhookAddressProblem(value) ? t('appearance.personNeededWebhook.addressInvalid') : undefined
})
const testOutcome = computed(() => {
  const result = tested.value
  if (!result) return undefined
  if (result.ok) return t('appearance.personNeededWebhook.testSent')
  if (result.reason === 'refused') return t('appearance.personNeededWebhook.testRefused', { status: result.status ?? 0 })
  if (result.reason === 'timeout') return t('appearance.personNeededWebhook.testTimeout')
  if (result.reason === 'no-address') return t('appearance.personNeededWebhook.addressMissing')
  return t('appearance.personNeededWebhook.testUnreachable')
})

function show(settings: PersonNeededWebhookSettings): void {
  saved.value = settings
  kind.value = settings.kind
  address.value = settings.url
}

onMounted(async () => {
  try {
    show(await window.hronautSettings.getPersonNeededWebhook())
  } catch (error) {
    emit('settingError', error)
  }
})

function kindLabel(value: PersonNeededWebhookKind): string {
  if (value === 'json') return t('appearance.personNeededWebhook.ownEndpoint')
  return { slack: 'Slack', discord: 'Discord', ntfy: 'ntfy' }[value]
}

async function changeEnabled(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  tested.value = null
  attempted.value = false
  if (input.checked && !saved.value?.url) {
    opening.value = true
    return
  }
  opening.value = false
  try {
    show(await window.hronautSettings.setPersonNeededWebhook({ enabled: input.checked, kind: kind.value, url: saved.value?.url ?? '' }))
  } catch (error) {
    input.checked = shown.value
    emit('settingError', error)
  }
}

/** Saves the address and turns the webhook on; false when the address cannot take messages. */
async function save(): Promise<boolean> {
  attempted.value = true
  if (addressError.value) return false
  busy.value = true
  try {
    show(await window.hronautSettings.setPersonNeededWebhook({ enabled: true, kind: kind.value, url: address.value.trim() }))
    opening.value = false
    attempted.value = false
    return true
  } catch (error) {
    emit('settingError', error)
    return false
  } finally {
    busy.value = false
  }
}

async function sendTest(): Promise<void> {
  tested.value = null
  if (pending.value && !(await save())) return
  busy.value = true
  try {
    tested.value = await window.hronautSettings.testPersonNeededWebhook()
  } catch (error) {
    emit('settingError', error)
  } finally {
    busy.value = false
  }
}

async function copySecret(): Promise<void> {
  if (!saved.value) return
  try {
    await window.hronaut.copyText(saved.value.secret)
    copied.value = true
  } catch (error) {
    emit('settingError', error)
  }
}

async function renewSecret(): Promise<void> {
  copied.value = false
  try {
    show(await window.hronautSettings.renewPersonNeededWebhookSecret())
  } catch (error) {
    emit('settingError', error)
  }
}
</script>

<template>
  <label class="settings-row" :for="switchId">
    <span>
      <strong>{{ t('appearance.personNeededWebhook.label') }}</strong>
      <small>{{ t('appearance.personNeededWebhook.description') }}</small>
    </span>
    <UiCheckbox :id="switchId" bare appearance="switch" :checked="shown" :disabled="!saved" @change="changeEnabled" />
  </label>
  <form v-if="shown && saved" class="person-needed-webhook-form" novalidate @submit.prevent="save">
    <div class="settings-row">
      <label :for="kindId">
        <strong>{{ t('appearance.personNeededWebhook.sendTo') }}</strong>
      </label>
      <div class="attention-sound-actions">
        <select :id="kindId" v-model="kind">
          <option v-for="option in PERSON_NEEDED_WEBHOOK_KINDS" :key="option" :value="option">{{ kindLabel(option) }}</option>
        </select>
      </div>
    </div>
    <UiField :label="t('appearance.personNeededWebhook.address')" :hint="t('appearance.personNeededWebhook.addressHint')" :error="addressError">
      <UiInput v-model="address" type="url" maxlength="2048" autocomplete="off" autocapitalize="off" spellcheck="false" />
    </UiField>
    <div class="attention-sound-actions">
      <UiButton variant="primary" type="submit" :disabled="busy || !pending">{{ t('appearance.personNeededWebhook.save') }}</UiButton>
      <UiButton type="button" :busy="busy" @click="sendTest">{{ t('appearance.personNeededWebhook.test') }}</UiButton>
    </div>
    <p v-if="testOutcome" role="status" class="person-needed-webhook-outcome" :data-ok="tested?.ok ? 'true' : 'false'">{{ testOutcome }}</p>
    <div class="settings-row">
      <span>
        <strong>{{ t('appearance.personNeededWebhook.secret') }}</strong>
        <small>{{ t('appearance.personNeededWebhook.secretHint') }}</small>
      </span>
      <div class="attention-sound-actions">
        <UiButton type="button" @click="copySecret">
          {{ copied ? t('appearance.personNeededWebhook.copied') : t('appearance.personNeededWebhook.copy') }}
        </UiButton>
        <UiButton type="button" @click="renewSecret">{{ t('appearance.personNeededWebhook.renew') }}</UiButton>
      </div>
    </div>
  </form>
</template>
