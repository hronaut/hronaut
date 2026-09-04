<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import { ATTENTION_SOUND_CUES, type AttentionSoundCue, type LanguagePreference, type TabPosition, type ThemeName } from '../../../shared/types.js'
import { INTERFACE_SCALE_OPTIONS, type InterfaceScale } from '../../../shared/interface-scale.js'
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
const titleBarRestartRequired = computed(() => (
  (settings.value.useSystemTitleBar ? 'system' : 'overlay') !== (window.hronautShell?.windowChrome.mode ?? 'overlay')
))

const themeGroups = computed<Array<{
  name: 'regular' | 'expressive'
  label: string
  themes: Array<{ name: ThemeName; label: string; description: string }>
}>>(() => [
  {
    name: 'regular',
    label: t('appearance.themeCategories.regular'),
    themes: [
      { name: 'system', label: t('appearance.themes.system.label'), description: t('appearance.themes.system.description') },
      { name: 'light', label: t('appearance.themes.light.label'), description: t('appearance.themes.light.description') },
      { name: 'dark', label: t('appearance.themes.dark.label'), description: t('appearance.themes.dark.description') },
      { name: 'midnight', label: t('appearance.themes.midnight.label'), description: t('appearance.themes.midnight.description') },
      { name: 'sepia', label: t('appearance.themes.sepia.label'), description: t('appearance.themes.sepia.description') }
    ]
  },
  {
    name: 'expressive',
    label: t('appearance.themeCategories.expressive'),
    themes: [
      { name: 'cyberpunk', label: t('appearance.themes.cyberpunk.label'), description: t('appearance.themes.cyberpunk.description') },
      { name: 'matrix', label: t('appearance.themes.matrix.label'), description: t('appearance.themes.matrix.description') },
      { name: 'machine', label: t('appearance.themes.machine.label'), description: t('appearance.themes.machine.description') },
      { name: 'galactic', label: t('appearance.themes.galactic.label'), description: t('appearance.themes.galactic.description') }
    ]
  }
])

const attentionSoundOptions = computed(() => ATTENTION_SOUND_CUES.map((cue) => ({
  cue,
  label: t(`appearance.attentionSound.cues.${cue}`)
})))

function localizedScaleLabel(value: InterfaceScale): string {
  if (value === 1) return t('appearance.interfaceSize.compact')
  if (value === 1.1) return t('appearance.interfaceSize.comfortable')
  return t('appearance.interfaceSize.large')
}

function localizedScaleDescription(value: InterfaceScale): string {
  if (value === 1) return t('appearance.interfaceSize.compactDescription')
  if (value === 1.1) return t('appearance.interfaceSize.comfortableDescription')
  return t('appearance.interfaceSize.largeDescription')
}

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

function selectTheme(theme: ThemeName): void {
  void runSetting(store.setTheme(theme))
}

function navigateTheme(event: KeyboardEvent): void {
  const current = event.currentTarget
  if (!(current instanceof HTMLButtonElement)) return
  const radios = [...(current.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[data-theme]') ?? [])]
  const currentIndex = radios.indexOf(current)
  if (currentIndex < 0 || radios.length === 0) return
  let targetIndex: number
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') targetIndex = (currentIndex + 1) % radios.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') targetIndex = (currentIndex - 1 + radios.length) % radios.length
  else if (event.key === 'Home') targetIndex = 0
  else if (event.key === 'End') targetIndex = radios.length - 1
  else return
  event.preventDefault()
  const target = radios[targetIndex]
  const theme = target?.dataset.theme as ThemeName | undefined
  if (!target || !theme) return
  target.focus()
  selectTheme(theme)
}

async function selectInterfaceScale(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const scale = Number(input.value) as InterfaceScale
  if (!(await runSetting(store.setInterfaceScale(scale)))) input.value = String(settings.value.interfaceScale)
}

async function selectTabPosition(event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  if (!(await runSetting(store.setTabPosition(input.value as TabPosition)))) {
    input.value = settings.value.tabPosition
  }
}

async function setHideInTray(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setHideInTray(input.checked)))) input.checked = settings.value.hideInTray
}

async function setUseSystemTitleBar(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await runSetting(store.setUseSystemTitleBar(input.checked)))) {
    input.checked = settings.value.useSystemTitleBar
  }
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
</script>

<template>
  <div class="settings-content">
    <div class="setting-copy">
      <h3>{{ t('appearance.heading') }}</h3>
      <p>{{ t('appearance.description') }}</p>
    </div>
    <div class="theme-groups" role="radiogroup" :aria-label="t('appearance.themeGroup')">
      <section v-for="group in themeGroups" :key="group.name" class="theme-group">
        <h4>{{ group.label }}</h4>
        <div class="theme-options">
          <UiButton appearance="application"
            v-for="theme in group.themes"
            :key="theme.name"
            class="theme-option"
            :class="[`theme-${theme.name}`, { selected: settings.theme === theme.name }]"
            type="button"
            role="radio"
            :aria-checked="settings.theme === theme.name"
            :tabindex="settings.theme === theme.name ? 0 : -1"
            :data-theme="theme.name"
            :data-testid="`theme-${theme.name}`"
            @click="selectTheme(theme.name)"
            @keydown="navigateTheme"
          >
            <span class="theme-preview" aria-hidden="true">
              <span class="preview-tab" />
              <span class="preview-bar" />
              <span class="preview-page" />
            </span>
            <span class="theme-label">{{ theme.label }}</span>
            <span class="theme-description">{{ theme.description }}</span>
            <span class="theme-check" aria-hidden="true"><IconCheck /></span>
          </UiButton>
        </div>
      </section>
    </div>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('appearance.systemThemeHelp') }}</p>
    </div>
    <div class="settings-rows">
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
      <label class="settings-row" for="setting-interface-scale">
        <span>
          <strong>{{ t('appearance.interfaceSize.label') }}</strong>
          <small>{{ t('appearance.interfaceSize.description') }}</small>
        </span>
        <select
          id="setting-interface-scale"
          :aria-label="t('appearance.interfaceSize.label')"
          :value="settings.interfaceScale"
          @change="selectInterfaceScale"
        >
          <option v-for="option in INTERFACE_SCALE_OPTIONS" :key="option.value" :value="option.value">
            {{ localizedScaleLabel(option.value) }} · {{ localizedScaleDescription(option.value) }}
          </option>
        </select>
      </label>
      <label class="settings-row" for="setting-tab-position">
        <span>
          <strong>{{ t('appearance.tabPosition.label') }}</strong>
          <small>{{ t('appearance.tabPosition.description') }}</small>
        </span>
        <select
          id="setting-tab-position"
          :aria-label="t('appearance.tabPosition.label')"
          :value="settings.tabPosition"
          @change="selectTabPosition"
        >
          <option value="top">{{ t('appearance.tabPosition.top') }}</option>
          <option value="left">{{ t('appearance.tabPosition.left') }}</option>
        </select>
      </label>
      <label class="settings-row" for="setting-system-title-bar">
        <span>
          <strong>{{ t('appearance.systemTitleBar.label') }}</strong>
          <small>{{ t('appearance.systemTitleBar.description') }}</small>
          <small v-if="titleBarRestartRequired" class="setting-restart-required" role="status">
            {{ t('appearance.systemTitleBar.restartRequired') }}
          </small>
        </span>
        <input
          id="setting-system-title-bar"
          type="checkbox"
          :checked="settings.useSystemTitleBar"
          @change="setUseSystemTitleBar"
        />
      </label>
      <label class="settings-row" for="setting-hide-in-tray">
        <span>
          <strong>{{ t('appearance.hideInTray.label') }}</strong>
          <small>{{ t('appearance.hideInTray.description') }}</small>
        </span>
        <input id="setting-hide-in-tray" type="checkbox" :checked="settings.hideInTray" @change="setHideInTray" />
      </label>
      <label class="settings-row" for="setting-attention-sound">
        <span>
          <strong>{{ t('appearance.playAttentionSound.label') }}</strong>
          <small>{{ t('appearance.playAttentionSound.description') }}</small>
        </span>
        <input id="setting-attention-sound" type="checkbox" :checked="settings.attentionSound" @change="setAttentionSound" />
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
          <UiButton appearance="application" class="test-sound-button" type="button" :disabled="!settings.attentionSound" @click="emit('testSound')">
            {{ t('appearance.attentionSound.test') }}
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>
