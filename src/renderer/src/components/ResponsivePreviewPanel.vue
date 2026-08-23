<script setup lang="ts">
import { computed, onBeforeUnmount, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDevices from '~icons/material-symbols/devices-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconScreenRotation from '~icons/material-symbols/screen-rotation-alt-rounded'
import { formatNumber } from '../../../shared/format.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type {
  BrowserState,
  BrowserTabState,
  BrowserViewportEmulation,
  PanelDock
} from '../../../shared/types.js'
import { BROWSER_VIEWPORT_PRESETS } from '../../../shared/viewport-presets.js'
import { useResponsivePreviewController } from '../composables/useResponsivePreviewController.js'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  setTabViewport: (tabId: string, viewport: BrowserViewportEmulation | null) => Promise<BrowserState>
  syncState: (operation: Promise<BrowserState>) => Promise<void>
  beginMutation: () => number
  isMutationCurrent: (sequence: number, tabId: string) => boolean
  closeTransientPanels: () => void
}>()

const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  presetId,
  orientation,
  width,
  height,
  deviceScaleFactor,
  mobile,
  touch,
  state,
  error,
  pendingAction,
  viewport,
  markDraftChanged,
  loadDraft,
  selectPreset,
  setOrientation,
  toggleOrientation,
  toggle,
  apply,
  reset,
  handleEscape,
  resetFeedback,
  dispose
} = useResponsivePreviewController({
  open,
  activeTab: toRef(props, 'activeTab'),
  setTabViewport: props.setTabViewport,
  syncState: props.syncState,
  beginMutation: props.beginMutation,
  isMutationCurrent: props.isMutationCurrent,
  closeTransientPanels: props.closeTransientPanels
})

const summary = computed(() => {
  if (!viewport.value) return t('runtime.responsive.invalid')
  return t('runtime.responsive.summary', {
    size: `${formatNumber(props.locale, viewport.value.width)}×${formatNumber(props.locale, viewport.value.height)}`,
    scale: formatNumber(props.locale, viewport.value.deviceScaleFactor),
    rendering: t(viewport.value.mobile ? 'runtime.responsive.mobile' : 'runtime.responsive.desktop'),
    input: t(viewport.value.touch ? 'runtime.responsive.touch' : 'runtime.responsive.pointer')
  })
})

defineExpose({ toggle, loadDraft, resetFeedback, handleEscape })
onBeforeUnmount(dispose)
</script>

<template>
  <section
    v-if="open"
    class="accessibility-panel responsive-preview-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="responsive-preview-title"
    :aria-busy="pendingAction !== null"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('responsive.kicker') }}</span>
        <h2 id="responsive-preview-title">{{ t('responsive.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panelDocks.responsive')" />
        <button class="panel-close" type="button" :aria-label="t('responsive.close')" @click="open = false"><IconClose aria-hidden="true" /></button>
      </div>
    </header>
    <form class="responsive-preview-content" @submit.prevent="apply">
      <section aria-labelledby="responsive-presets-title">
        <div class="responsive-section-heading">
          <div><h3 id="responsive-presets-title">{{ t('responsive.preset') }}</h3><p>{{ t('responsive.presetHelp') }}</p></div>
          <button type="button" :title="t('responsive.rotateTitle')" :aria-label="t('responsive.rotateAria')" @click="toggleOrientation"><IconScreenRotation aria-hidden="true" /> {{ t('responsive.rotate') }}</button>
        </div>
        <div class="responsive-preset-grid" role="group" :aria-label="t('responsive.presetAria')">
          <button
            v-for="preset in BROWSER_VIEWPORT_PRESETS"
            :key="preset.id"
            type="button"
            :class="{ selected: presetId === preset.id }"
            :aria-pressed="presetId === preset.id"
            @click="selectPreset(preset.id)"
          >
            <strong>{{ preset.label }}</strong>
            <span>{{ preset.width }}×{{ preset.height }} · {{ preset.deviceScaleFactor }}×</span>
            <small>{{ preset.description }}</small>
          </button>
          <button
            type="button"
            :class="{ selected: presetId === 'custom' }"
            :aria-pressed="presetId === 'custom'"
            @click="selectPreset('custom')"
          >
            <strong>{{ t('responsive.custom') }}</strong>
            <span>{{ t('responsive.range') }}</span>
            <small>{{ t('responsive.customDescription') }}</small>
          </button>
        </div>
      </section>
      <section class="responsive-orientation" aria-labelledby="responsive-orientation-title">
        <div><h3 id="responsive-orientation-title">{{ t('responsive.orientation') }}</h3><p>{{ t('responsive.orientationHelp') }}</p></div>
        <div role="group" :aria-label="t('responsive.orientationAria')">
          <button type="button" :class="{ selected: orientation === 'portrait' }" :aria-pressed="orientation === 'portrait'" @click="setOrientation('portrait')">{{ t('responsive.portrait') }}</button>
          <button type="button" :class="{ selected: orientation === 'landscape' }" :aria-pressed="orientation === 'landscape'" @click="setOrientation('landscape')">{{ t('responsive.landscape') }}</button>
        </div>
      </section>
      <section v-if="presetId === 'custom'" class="responsive-custom" aria-labelledby="responsive-custom-title">
        <div><h3 id="responsive-custom-title">{{ t('responsive.customConditions') }}</h3><p>{{ t('responsive.cssPixels') }}</p></div>
        <div class="responsive-fields">
          <label>{{ t('responsive.width') }}<input v-model.number="width" type="number" min="200" max="3840" step="1" required @input="markDraftChanged" /></label>
          <label>{{ t('responsive.height') }}<input v-model.number="height" type="number" min="200" max="3840" step="1" required @input="markDraftChanged" /></label>
          <label>{{ t('responsive.dpr') }}<input v-model.number="deviceScaleFactor" type="number" min="0.5" max="5" step="0.5" required @input="markDraftChanged" /></label>
        </div>
        <div class="responsive-toggles">
          <label><input v-model="mobile" type="checkbox" @change="markDraftChanged" /> {{ t('responsive.mobile') }}</label>
          <label><input v-model="touch" type="checkbox" @change="markDraftChanged" /> {{ t('responsive.touch') }}</label>
        </div>
      </section>
      <output class="responsive-preview-summary" :class="{ error: state === 'error' || !viewport }" aria-live="polite">
        <IconDevices aria-hidden="true" />
        <span><strong>{{ state === 'applied' ? t('responsive.applied') : pendingAction !== null ? t('responsive.applyingViewport') : t('responsive.previewConditions') }}</strong><small>{{ error || summary }}</small></span>
      </output>
      <p class="responsive-preview-caveat"><IconInfo aria-hidden="true" /> {{ t('responsive.limitation') }}</p>
      <footer>
        <button type="button" :disabled="!activeTab?.emulation?.viewport || pendingAction !== null" @click="reset">{{ t('responsive.reset') }}</button>
        <button class="primary" type="submit" :disabled="!viewport || pendingAction !== null">
          <IconProgress v-if="pendingAction !== null" class="state-spinner" aria-hidden="true" />
          <IconDevices v-else aria-hidden="true" />
          {{ pendingAction !== null ? t('responsive.applying') : t('responsive.apply') }}
        </button>
      </footer>
    </form>
  </section>
</template>
