<script setup lang="ts">
import IconClose from '~icons/material-symbols/close-rounded'
import UiButton from "../ui/UiButton.vue"
import UiCheckbox from "../ui/UiCheckbox.vue"
import UiIconButton from '../ui/UiIconButton.vue'
import { computed, nextTick, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { ATTENTION_SOUND_CUES, type AttentionSoundCue, type LanguagePreference, type SpellCheckLanguages } from '../../../shared/types.js'
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES } from '../../../shared/locale.js'
import { ignoreHeldEnter } from '../held-enter.js'
import { useSettingsStore } from '../stores/settings.js'

const emit = defineEmits<{
  testSound: []
  settingError: [error: unknown]
}>()
const { t, locale } = useI18n({ useScope: 'global' })
const store = useSettingsStore()
const { settings, systemLocale, languageChangeError } = storeToRefs(store)
const savingLanguage = ref(false)
// None until main says which dictionaries there are, and none on macOS, where the system picks the language.
const spellCheckLanguageOptions = ref<SpellCheckLanguages>({ available: [], automatic: [] })
const savingSpellCheckLanguages = ref(false)
const spellCheckLanguageList = ref<HTMLUListElement | null>(null)

onMounted(async () => {
  try {
    spellCheckLanguageOptions.value = await window.hronautSettings.getSpellCheckLanguages()
  } catch {
    // Without the list there is nothing to choose from, so the row stays hidden.
  }
})

/** The languages checked now: the chosen ones Hronaut has dictionaries for, or the automatic one. */
const spellCheckLanguages = computed(() => {
  const { available, automatic } = spellCheckLanguageOptions.value
  const chosen = settings.value.spellCheckLanguages.filter((language) => available.includes(language))
  return chosen.length ? chosen : automatic
})

/** Every other language with a dictionary, by its name in the interface language. */
const addableSpellCheckLanguages = computed(() => spellCheckLanguageOptions.value.available
  .filter((language) => !spellCheckLanguages.value.includes(language))
  .map((language) => ({ language, name: spellCheckLanguageName(language) }))
  .sort((first, second) => first.name.localeCompare(second.name, locale.value)))

const languageNames = computed(() => {
  try {
    return new Intl.DisplayNames([locale.value], { type: 'language' })
  } catch {
    return undefined
  }
})

/** The language's name in the interface language, starting with a capital as a list item does. */
function spellCheckLanguageName(language: string): string {
  try {
    const name = languageNames.value?.of(language)
    return name ? name.charAt(0).toLocaleUpperCase(locale.value) + name.slice(1) : language
  } catch {
    return language
  }
}

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

async function setSpellCheck(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setSpellCheck(input.checked)))) input.checked = settings.value.spellCheck
}

async function saveSpellCheckLanguages(languages: string[]): Promise<void> {
  savingSpellCheckLanguages.value = true
  try {
    await runSetting(store.setSpellCheckLanguages(languages))
  } finally {
    savingSpellCheckLanguages.value = false
  }
}

async function addSpellCheckLanguage(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const language = input.value
  // The select only adds: it goes back to its prompt whether or not the change saves.
  input.value = ''
  if (!language) return
  await saveSpellCheckLanguages([...spellCheckLanguages.value, language])
  // Chromium takes focus off the select while the save disables it; it goes back there, where the person was.
  await nextTick()
  if (input.isConnected && (!document.activeElement || document.activeElement === document.body)) input.focus()
}

async function removeSpellCheckLanguage(language: string): Promise<void> {
  if (!settings.value.spellCheck || savingSpellCheckLanguages.value || spellCheckLanguages.value.length < 2) return
  await saveSpellCheckLanguages(spellCheckLanguages.value.filter((checked) => checked !== language))
  // Focus that was on the removed language's button stays with the list rather than dropping out of the dialog; the
  // list takes no key, so a held Enter removes nothing more.
  await nextTick()
  if (!document.activeElement || document.activeElement === document.body) spellCheckLanguageList.value?.focus()
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
      <label class="settings-row" for="setting-spell-check">
        <span>
          <strong>{{ t('appearance.spellCheck.label') }}</strong>
          <small>{{ t('appearance.spellCheck.description') }}</small>
        </span>
        <UiCheckbox bare appearance="switch" id="setting-spell-check" :checked="settings.spellCheck" @change="setSpellCheck" />
      </label>
      <template v-if="spellCheckLanguageOptions.available.length">
        <div class="settings-row spell-check-languages-row">
          <span>
            <strong id="spell-check-languages-label">{{ t('appearance.spellCheckLanguages.label') }}</strong>
            <small>{{ t('appearance.spellCheckLanguages.description') }}</small>
          </span>
          <select
            :aria-label="t('appearance.spellCheckLanguages.add')"
            value=""
            :disabled="!settings.spellCheck || savingSpellCheckLanguages"
            @keydown="ignoreHeldEnter"
            @change="addSpellCheckLanguage"
          >
            <option value="" disabled>{{ t('appearance.spellCheckLanguages.add') }}</option>
            <option v-for="option in addableSpellCheckLanguages" :key="option.language" :value="option.language">{{ option.name }}</option>
          </select>
        </div>
        <ul ref="spellCheckLanguageList" class="spell-check-language-list" tabindex="-1" aria-labelledby="spell-check-languages-label">
          <li v-for="language in spellCheckLanguages" :key="language" class="spell-check-language" :data-spell-check-language="language">
            <span>{{ spellCheckLanguageName(language) }}</span>
            <UiIconButton
              :label="t('appearance.spellCheckLanguages.remove', { language: spellCheckLanguageName(language) })"
              :aria-disabled="!settings.spellCheck || savingSpellCheckLanguages || spellCheckLanguages.length < 2 || undefined"
              @keydown="ignoreHeldEnter"
              @click="removeSpellCheckLanguage(language)"
            >
              <IconClose aria-hidden="true" />
            </UiIconButton>
          </li>
        </ul>
      </template>
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
