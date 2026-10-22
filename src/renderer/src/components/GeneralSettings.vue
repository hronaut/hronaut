<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import UiCheckbox from "../ui/UiCheckbox.vue"
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ATTENTION_SOUND_CUES, type AttentionSoundCue, type LanguagePreference } from '../../../shared/types.js'
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from '../../../shared/locale.js'
import { useSettingsStore } from '../stores/settings.js'

const emit = defineEmits<{
  testSound: []
  settingError: [error: unknown]
}>()
const { t } = useI18n({ useScope: 'global' })
const store = useSettingsStore()
const { settings, systemLocale, languageChangeError } = storeToRefs(store)
const savingLanguage = ref(false)

const attentionSoundOptions = computed(() => ATTENTION_SOUND_CUES.map((cue) => ({
  cue,
  label: t(`appearance.attentionSound.cues.${cue}`)
})))

function systemLanguageName(): string {
  return LOCALE_NATIVE_NAMES[systemLocale.value]
}

async function runSetting(operation: Promise<unknown>): Promise<boolean> {
  try {
    await operation
    return true
  } catch (error) {
    emit('settingError', error)
    return false
  }
}

async function setLanguagePreference(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const previous = settings.value.languagePreference
  savingLanguage.value = true
  try {
    await store.setLanguagePreference(input.value as LanguagePreference)
  } catch (error) {
    input.value = previous
    emit('settingError', error)
  } finally {
    savingLanguage.value = false
  }
}

async function setHideInTray(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setHideInTray(input.checked)))) input.checked = settings.value.hideInTray
}

async function setLaunchAtStartup(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setLaunchAtStartup(input.checked)))) input.checked = settings.value.launchAtStartup
}

async function setLaunchMinimized(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setLaunchMinimized(input.checked)))) input.checked = settings.value.launchMinimized
}

async function setAttentionSound(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setAttentionSound(input.checked)))) input.checked = settings.value.attentionSound
}

async function setAttentionSoundCue(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  if (!(await runSetting(store.setAttentionSoundCue(input.value as AttentionSoundCue)))) {
    input.value = settings.value.attentionSoundCue
  }
}

async function setShowAgentCursor(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setShowAgentCursor(input.checked)))) input.checked = settings.value.showAgentCursor
}

async function setPinAgentLiveStatus(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setPinAgentLiveStatus(input.checked)))) input.checked = settings.value.pinAgentLiveStatus
}
</script>

<template>
  <div class="settings-content">
    <div class="setting-copy">
      <h3>{{ t('settingsSections.general.heading') }}</h3>
      <p>{{ t('settingsSections.general.description') }}</p>
    </div>
    <div class="settings-rows grouped">
      <label class="settings-row" for="setting-language">
        <span>
          <strong>{{ t('appearance.language.label') }}</strong>
          <small>{{ t('appearance.language.description') }}</small>
        </span>
        <select
          id="setting-language"
          :aria-label="t('appearance.language.label')"
          :value="settings.languagePreference"
          :disabled="savingLanguage"
          @change="setLanguagePreference"
        >
          <option value="system">{{ t('appearance.language.systemOption', { language: systemLanguageName() }) }}</option>
          <option v-for="locale in SUPPORTED_LOCALES" :key="locale" :value="locale">{{ LOCALE_NATIVE_NAMES[locale] }}</option>
        </select>
      </label>
      <output v-if="languageChangeError" class="download-settings-status error" role="alert">
        {{ t('appearance.language.changeFailed') }}
      </output>
    </div>
    <h4 class="settings-group-heading">{{ t('settingsSections.generalGroups.startup') }}</h4>
    <div class="settings-rows grouped">
      <label class="settings-row" for="setting-hide-in-tray">
        <span>
          <strong>{{ t('appearance.hideInTray.label') }}</strong>
          <small>{{ t('appearance.hideInTray.description') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-hide-in-tray" :checked="settings.hideInTray" @change="setHideInTray" />
      </label>
      <label class="settings-row" for="setting-launch-at-startup">
        <span>
          <strong>{{ t('appearance.launchAtStartup.label') }}</strong>
          <small>{{ t('appearance.launchAtStartup.description') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-launch-at-startup" :checked="settings.launchAtStartup" @change="setLaunchAtStartup" />
      </label>
      <label class="settings-row" for="setting-launch-minimized">
        <span>
          <strong>{{ t('appearance.launchMinimized.label') }}</strong>
          <small>{{ t('appearance.launchMinimized.description') }}</small>
        </span>
        <UiCheckbox
          bare
          appearance="switch"
          id="setting-launch-minimized"
          :checked="settings.launchMinimized"
          :disabled="!settings.launchAtStartup"
          @change="setLaunchMinimized"
        />
      </label>
    </div>
    <h4 class="settings-group-heading">{{ t('settingsSections.generalGroups.agents') }}</h4>
    <div class="settings-rows grouped">
      <label class="settings-row" for="setting-attention-sound">
        <span>
          <strong>{{ t('appearance.playAttentionSound.label') }}</strong>
          <small>{{ t('appearance.playAttentionSound.description') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-attention-sound" :checked="settings.attentionSound" @change="setAttentionSound" />
      </label>
      <div class="settings-row">
        <span>
          <strong>{{ t('appearance.attentionSound.label') }}</strong>
          <small>{{ t('appearance.attentionSound.description') }}</small>
        </span>
        <div class="attention-sound-actions">
          <select
            :aria-label="t('appearance.attentionSound.label')"
            :value="settings.attentionSoundCue"
            :disabled="!settings.attentionSound"
            @change="setAttentionSoundCue"
          >
            <option v-for="option in attentionSoundOptions" :key="option.cue" :value="option.cue">{{ option.label }}</option>
          </select>
          <UiButton class="test-sound-button" type="button" :disabled="!settings.attentionSound" @click="emit('testSound')">
            {{ t('appearance.attentionSound.test') }}
          </UiButton>
        </div>
      </div>
      <label class="settings-row" for="setting-agent-cursor">
        <span>
          <strong>{{ t('appearance.agentCursor.label') }}</strong>
          <small>{{ t('appearance.agentCursor.description') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-agent-cursor" :checked="settings.showAgentCursor" @change="setShowAgentCursor" />
      </label>
      <label class="settings-row" for="setting-agent-strip">
        <span>
          <strong>{{ t('appearance.agentStrip.label') }}</strong>
          <small>{{ t('appearance.agentStrip.description') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-agent-strip" :checked="settings.pinAgentLiveStatus" @change="setPinAgentLiveStatus" />
      </label>
    </div>
  </div>
</template>
