<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDevices from '~icons/material-symbols/devices-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import IconSpeed from '~icons/material-symbols/speed-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { formatNumber } from '../../../shared/format.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type { BrowserTabState, PanelDock } from '../../../shared/types.js'
import type { useEnvironmentPanelController } from '../composables/useEnvironmentPanelController.js'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  controller: ReturnType<typeof useEnvironmentPanelController>
  openResponsivePreview: () => void
}>()

const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  draft,
  locationEnabled,
  latitude,
  longitude,
  accuracy,
  state,
  error,
  pendingAction,
  settings,
  activeOverrideCount,
  markDraftChanged,
  apply,
  reset,
  handleEscape,
  dispose
} = props.controller

const localNumber = (value: number): string => formatNumber(props.locale, value)

defineExpose({ handleEscape })
onBeforeUnmount(dispose)
</script>

<template>
  <section
    v-if="open"
    class="accessibility-panel environment-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="environment-panel-title"
    :aria-busy="pendingAction !== null"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('environment.kicker') }}</span>
        <h2 id="environment-panel-title">{{ t('environment.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('environment.heading') })" />
        <UiButton native class="panel-close" type="button" :aria-label="t('environment.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <form class="environment-content" @submit.prevent="apply(false)">
      <section aria-labelledby="environment-speed-title">
        <div class="environment-section-heading">
          <div><h3 id="environment-speed-title">{{ t('environment.loading.heading') }}</h3><p>{{ t('environment.loading.description') }}</p></div>
        </div>
        <div class="environment-field-grid">
          <label>
            <span>{{ t('environment.network.label') }}</span>
            <select v-model="draft.network" :aria-label="t('environment.network.label')" @change="markDraftChanged">
              <option value="none">{{ t('environment.network.none') }}</option>
              <option value="fast-4g">{{ t('environment.network.fast4g') }}</option>
              <option value="slow-4g">{{ t('environment.network.slow4g') }}</option>
              <option value="slow-3g">{{ t('environment.network.slow3g') }}</option>
              <option value="offline">{{ t('environment.network.offline') }}</option>
            </select>
            <small>{{ t('environment.network.help') }}</small>
          </label>
          <label>
            <span>{{ t('environment.cpu.label') }}</span>
            <select v-model.number="draft.cpuThrottlingRate" :aria-label="t('environment.cpu.label')" @change="markDraftChanged">
              <option :value="1">{{ t('environment.cpu.none') }}</option>
              <option :value="2">{{ t('environment.cpu.x2') }}</option>
              <option :value="4">{{ t('environment.cpu.x4') }}</option>
              <option :value="6">{{ t('environment.cpu.x6') }}</option>
              <option :value="20">{{ t('environment.cpu.x20') }}</option>
            </select>
            <small>{{ t('environment.cpu.help') }}</small>
          </label>
          <label class="environment-field-wide">
            <span>{{ t('environment.dataSaver.label') }}</span>
            <select v-model="draft.dataSaver" :aria-label="t('environment.dataSaver.label')" @change="markDraftChanged">
              <option value="auto">{{ t('environment.dataSaver.system') }}</option>
              <option value="enabled">{{ t('environment.dataSaver.enabled') }}</option>
              <option value="disabled">{{ t('environment.dataSaver.disabled') }}</option>
            </select>
            <small>{{ t('environment.dataSaver.help') }}</small>
          </label>
        </div>
        <label class="environment-toggle">
          <input v-model="draft.cacheDisabled" type="checkbox" @change="markDraftChanged" />
          <span><strong>{{ t('environment.cache.label') }}</strong><small>{{ t('environment.cache.help') }}</small></span>
        </label>
        <label class="environment-toggle">
          <input v-model="draft.bypassServiceWorker" type="checkbox" @change="markDraftChanged" />
          <span><strong>{{ t('environment.serviceWorker.label') }}</strong><small>{{ t('environment.serviceWorker.help') }}</small></span>
        </label>
        <p v-if="draft.network === 'offline'" class="environment-warning"><IconWarning aria-hidden="true" /> {{ t('environment.serviceWorker.offline') }}</p>
        <p v-if="draft.network === 'offline' && draft.bypassServiceWorker" class="environment-warning"><IconWarning aria-hidden="true" /> {{ t('environment.serviceWorker.combined') }}</p>
      </section>
      <section aria-labelledby="environment-runtime-title">
        <div class="environment-section-heading">
          <div><h3 id="environment-runtime-title">{{ t('environment.runtime.heading') }}</h3><p>{{ t('environment.runtime.description') }}</p></div>
        </div>
        <div class="environment-field-grid">
          <label class="environment-field-wide">
            <span>{{ t('environment.runtime.animation') }}</span>
            <select v-model.number="draft.animationPlaybackRate" :aria-label="t('environment.runtime.animation')" @change="markDraftChanged">
              <option :value="1">{{ t('environment.runtime.normal') }}</option>
              <option :value="0.25">{{ t('environment.runtime.quarter') }}</option>
              <option :value="0.1">{{ t('environment.runtime.tenth') }}</option>
              <option :value="0">{{ t('environment.runtime.paused') }}</option>
            </select>
            <small>{{ t('environment.runtime.animationHelp') }}</small>
          </label>
        </div>
        <label class="environment-toggle">
          <input v-model="draft.javaScriptDisabled" type="checkbox" @change="markDraftChanged" />
          <span><strong>{{ t('environment.runtime.disableJs') }}</strong><small>{{ t('environment.runtime.disableJsHelp') }}</small></span>
        </label>
        <p v-if="draft.javaScriptDisabled" class="environment-warning"><IconWarning aria-hidden="true" /> {{ t('environment.runtime.disableJsWarning') }}</p>
      </section>
      <section aria-labelledby="environment-rendering-title">
        <div class="environment-section-heading">
          <div><h3 id="environment-rendering-title">{{ t('environment.rendering.heading') }}</h3><p>{{ t('environment.rendering.description') }}</p></div>
        </div>
        <div class="environment-field-grid">
          <label>
            <span>{{ t('environment.rendering.media') }}</span>
            <select v-model="draft.mediaType" :aria-label="t('environment.rendering.media')" @change="markDraftChanged">
              <option value="auto">{{ t('environment.rendering.noOverride') }}</option>
              <option value="screen">{{ t('environment.rendering.screen') }}</option>
              <option value="print">{{ t('environment.rendering.print') }}</option>
            </select>
            <small>{{ t('environment.rendering.printHelp') }}</small>
          </label>
          <label>
            <span>{{ t('environment.rendering.colorScheme') }}</span>
            <select v-model="draft.colorScheme" :aria-label="t('environment.rendering.colorScheme')" @change="markDraftChanged">
              <option value="auto">{{ t('environment.rendering.noOverride') }}</option>
              <option value="light">{{ t('environment.rendering.light') }}</option>
              <option value="dark">{{ t('environment.rendering.dark') }}</option>
            </select>
            <small>{{ t('environment.rendering.colorHelp') }}</small>
          </label>
          <label>
            <span>{{ t('environment.rendering.forcedColors') }}</span>
            <select v-model="draft.forcedColors" :aria-label="t('environment.rendering.forcedColors')" @change="markDraftChanged">
              <option value="auto">{{ t('environment.rendering.noOverride') }}</option>
              <option value="active">{{ t('environment.rendering.active') }}</option>
              <option value="none">{{ t('environment.rendering.inactive') }}</option>
            </select>
            <small>{{ t('environment.rendering.forcedHelp') }}</small>
          </label>
          <label>
            <span>{{ t('environment.rendering.contrast') }}</span>
            <select v-model="draft.contrast" :aria-label="t('environment.rendering.contrast')" @change="markDraftChanged">
              <option value="auto">{{ t('environment.rendering.noOverride') }}</option>
              <option value="more">{{ t('environment.rendering.more') }}</option>
              <option value="less">{{ t('environment.rendering.less') }}</option>
              <option value="custom">{{ t('environment.rendering.custom') }}</option>
              <option value="no-preference">{{ t('environment.rendering.noPreference') }}</option>
            </select>
            <small>{{ t('environment.rendering.contrastHelp') }}</small>
          </label>
          <label>
            <span>{{ t('environment.rendering.motion') }}</span>
            <select v-model="draft.reducedMotion" :aria-label="t('environment.rendering.motion')" @change="markDraftChanged">
              <option value="auto">{{ t('environment.rendering.noOverride') }}</option>
              <option value="reduce">{{ t('environment.rendering.reduceMotion') }}</option>
              <option value="no-preference">{{ t('environment.rendering.noPreference') }}</option>
            </select>
            <small>{{ t('environment.rendering.motionHelp') }}</small>
          </label>
          <label>
            <span>{{ t('environment.rendering.transparency') }}</span>
            <select v-model="draft.reducedTransparency" :aria-label="t('environment.rendering.transparency')" @change="markDraftChanged">
              <option value="auto">{{ t('environment.rendering.noOverride') }}</option>
              <option value="reduce">{{ t('environment.rendering.reduceTransparency') }}</option>
              <option value="no-preference">{{ t('environment.rendering.noPreference') }}</option>
            </select>
            <small>{{ t('environment.rendering.transparencyHelp') }}</small>
          </label>
          <label class="environment-field-wide">
            <span>{{ t('environment.rendering.vision') }}</span>
            <select v-model="draft.visionDeficiency" :aria-label="t('environment.rendering.vision')" @change="markDraftChanged">
              <option value="none">{{ t('environment.rendering.noSimulation') }}</option>
              <option value="blurredVision">{{ t('environment.rendering.blurred') }}</option>
              <option value="reducedContrast">{{ t('environment.rendering.reducedContrast') }}</option>
              <option value="protanopia">{{ t('environment.rendering.protanopia') }}</option>
              <option value="deuteranopia">{{ t('environment.rendering.deuteranopia') }}</option>
              <option value="tritanopia">{{ t('environment.rendering.tritanopia') }}</option>
              <option value="achromatopsia">{{ t('environment.rendering.achromatopsia') }}</option>
            </select>
            <small>{{ t('environment.rendering.visionHelp') }}</small>
          </label>
        </div>
      </section>
      <section aria-labelledby="environment-debug-overlays-title">
        <div class="environment-section-heading">
          <div><h3 id="environment-debug-overlays-title">{{ t('environment.diagnostics.heading') }}</h3><p>{{ t('environment.diagnostics.description') }}</p></div>
        </div>
        <label class="environment-toggle"><input v-model="draft.renderingDebug.paintFlashing" type="checkbox" @change="markDraftChanged" /><span><strong>{{ t('environment.diagnostics.paint') }}</strong><small>{{ t('environment.diagnostics.paintHelp') }}</small></span></label>
        <label class="environment-toggle"><input v-model="draft.renderingDebug.layoutShiftRegions" type="checkbox" @change="markDraftChanged" /><span><strong>{{ t('environment.diagnostics.shifts') }}</strong><small>{{ t('environment.diagnostics.shiftsHelp') }}</small></span></label>
        <label class="environment-toggle"><input v-model="draft.renderingDebug.layerBorders" type="checkbox" @change="markDraftChanged" /><span><strong>{{ t('environment.diagnostics.layers') }}</strong><small>{{ t('environment.diagnostics.layersHelp') }}</small></span></label>
        <label class="environment-toggle"><input v-model="draft.renderingDebug.fpsCounter" type="checkbox" @change="markDraftChanged" /><span><strong>{{ t('environment.diagnostics.frames') }}</strong><small>{{ t('environment.diagnostics.framesHelp') }}</small></span></label>
        <label class="environment-toggle"><input v-model="draft.renderingDebug.scrollBottlenecks" type="checkbox" @change="markDraftChanged" /><span><strong>{{ t('environment.diagnostics.scrolling') }}</strong><small>{{ t('environment.diagnostics.scrollingHelp') }}</small></span></label>
        <p v-if="draft.renderingDebug.paintFlashing || draft.renderingDebug.layoutShiftRegions" class="environment-warning"><IconWarning aria-hidden="true" /> {{ t('environment.diagnostics.warning') }}</p>
      </section>
      <section aria-labelledby="environment-identity-title">
        <div class="environment-section-heading">
          <div><h3 id="environment-identity-title">{{ t('environment.identity.heading') }}</h3><p>{{ t('environment.identity.description') }}</p></div>
        </div>
        <div class="environment-field-grid environment-region-grid">
          <label>
            <span>{{ t('environment.identity.locale') }} <small>{{ t('environment.identity.optional') }}</small></span>
            <input v-model.trim="draft.locale" :aria-label="t('environment.identity.locale')" type="text" maxlength="64" :placeholder="t('environment.identity.localePlaceholder')" spellcheck="false" @input="markDraftChanged" />
            <small>{{ t('environment.identity.localeHelp') }}</small>
          </label>
          <label>
            <span>{{ t('environment.identity.timezone') }} <small>{{ t('environment.identity.optional') }}</small></span>
            <input v-model.trim="draft.timezoneId" :aria-label="t('environment.identity.timezone')" type="text" maxlength="100" :placeholder="t('environment.identity.timezonePlaceholder')" spellcheck="false" @input="markDraftChanged" />
            <small>{{ t('environment.identity.timezoneHelp') }}</small>
          </label>
        </div>
        <label class="environment-user-agent">
          <span>{{ t('environment.identity.userAgent') }} <small>{{ t('environment.identity.optional') }}</small></span>
          <input v-model="draft.userAgent" type="text" maxlength="512" :placeholder="t('environment.identity.userAgentPlaceholder')" spellcheck="false" @input="markDraftChanged" />
          <small>{{ t('environment.identity.userAgentHelp') }}</small>
        </label>
        <label class="environment-location-toggle">
          <input v-model="locationEnabled" type="checkbox" @change="markDraftChanged" />
          <span><strong>{{ t('environment.identity.geolocation') }}</strong><small>{{ t('environment.identity.geolocationHelp') }}</small></span>
        </label>
        <div v-if="locationEnabled" class="environment-location-fields">
          <label>{{ t('environment.identity.latitude') }}<input v-model.number="latitude" type="number" min="-90" max="90" step="0.000001" required @input="markDraftChanged" /></label>
          <label>{{ t('environment.identity.longitude') }}<input v-model.number="longitude" type="number" min="-180" max="180" step="0.000001" required @input="markDraftChanged" /></label>
          <label>{{ t('environment.identity.accuracy') }}<input v-model.number="accuracy" type="number" min="0" max="100000" step="1" required @input="markDraftChanged" /></label>
        </div>
      </section>
      <section v-if="activeTab?.emulation?.viewport || activeTab?.emulation?.extraHttpHeaderNames?.length" class="environment-managed" aria-labelledby="environment-managed-title">
        <div class="environment-section-heading">
          <div><h3 id="environment-managed-title">{{ t('environment.other.heading') }}</h3><p>{{ t('environment.other.description') }}</p></div>
        </div>
        <UiButton native v-if="activeTab?.emulation?.viewport" type="button" @click="openResponsivePreview">
          <IconDevices aria-hidden="true" />
          <span><strong>{{ activeTab.emulation.viewport.width }}×{{ activeTab.emulation.viewport.height }} {{ t('environment.other.viewport') }}</strong><small>{{ t('environment.other.openResponsive') }}</small></span>
        </UiButton>
        <div v-if="activeTab?.emulation?.extraHttpHeaderNames?.length" class="environment-header-names">
          <IconRoute aria-hidden="true" />
          <span><strong>{{ activeTab.emulation.extraHttpHeaderNames.length }} {{ t('environment.other.agentRequest') }} {{ activeTab.emulation.extraHttpHeaderNames.length === 1 ? t('environment.other.header') : t('environment.other.headers') }}</strong><small>{{ activeTab.emulation.extraHttpHeaderNames.join(', ') }} {{ t('environment.other.hidden') }}</small></span>
        </div>
      </section>
      <output class="environment-status" :class="{ error: state === 'error' || !settings, applied: state === 'applied' }" aria-live="polite">
        <IconError v-if="state === 'error' || !settings" aria-hidden="true" />
        <IconCheck v-else-if="state === 'applied'" aria-hidden="true" />
        <IconSpeed v-else aria-hidden="true" />
        <span><strong>{{ pendingAction !== null ? t('environment.applyingConditions') : state === 'applied' ? t('environment.applied') : !settings ? t('environment.checkValues') : t(activeOverrideCount === 1 ? 'environment.activeCondition' : 'environment.activeConditions', { count: localNumber(activeOverrideCount) }) }}</strong><small>{{ error || t('environment.applyHelp') }}</small></span>
      </output>
      <p class="responsive-preview-caveat"><IconInfo aria-hidden="true" /> {{ t('environment.limitation') }}</p>
      <footer>
        <UiButton native type="button" :disabled="pendingAction !== null" @click="reset">{{ t('environment.reset') }}</UiButton>
        <div>
          <UiButton native type="submit" :disabled="!settings || pendingAction !== null">{{ t('environment.apply') }}</UiButton>
          <UiButton native class="primary" type="button" :disabled="!settings || pendingAction !== null" @click="apply(true)">
            <IconProgress v-if="pendingAction !== null" class="state-spinner" aria-hidden="true" />
            <IconRefresh v-else aria-hidden="true" />
            {{ pendingAction !== null ? t('environment.applying') : t('environment.applyReload') }}
          </UiButton>
        </div>
      </footer>
    </form>
  </section>
</template>
