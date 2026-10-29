<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useResizeObserver } from '@vueuse/core'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAdsClick from '~icons/material-symbols/ads-click-rounded'
import IconBugReport from '~icons/material-symbols/bug-report-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconInfo from '~icons/material-symbols/info-outline-rounded'
import IconKeyboardArrowRight from '~icons/material-symbols/keyboard-arrow-right-rounded'
import IconPasskey from '~icons/material-symbols/passkey-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconSpeed from '~icons/material-symbols/speed-rounded'
import IconTune from '~icons/material-symbols/tune-rounded'
import type {
  BrowserTabState,
  PanelDock,
  SitePermissionDecision,
  SitePermissionEntry,
  SupportedLocale
} from '../../../shared/types.js'
import { hasSwitchToTabButton } from '../../../shared/address-suggestions.js'
import type { ActiveTabPresentationController } from '../composables/useActiveTabPresentationController.js'
import type { AddressBarController } from '../composables/useAddressBarController.js'
import type { EmulationController } from '../composables/useEmulationController.js'
import type { PageToolsPresentationController } from '../composables/usePageToolsPresentationController.js'
import type { SiteDataSummaryController } from '../composables/useSiteDataSummaryController.js'
import type { SitePermissionsController } from '../composables/useSitePermissionsController.js'
import SiteControlsPanel from './SiteControlsPanel.vue'
import { vTooltip } from '../ui/tooltip.js'

export interface BrowserAddressBarActions {
  toggleSiteControls: () => unknown
  resetActiveTabEmulation: () => unknown
  clearActiveCssStatePreview: () => unknown
  stopActiveVirtualPasskey: () => unknown
  stopActiveLogpoints: () => unknown
  openRequestConditions: () => unknown
  setSitePermission: (entry: SitePermissionEntry, decision: SitePermissionDecision) => boolean | Promise<boolean>
  resetSitePermission: (entry: SitePermissionEntry) => boolean | Promise<boolean>
  openSitePermissionSettings: () => void
  openSitePrivacySettings: () => void | Promise<void>
}

const props = defineProps<{
  activeTab: BrowserTabState | undefined
  addressController: AddressBarController
  activeTabPresentation: ActiveTabPresentationController
  emulationController: EmulationController
  pageToolsPresentation: PageToolsPresentationController
  siteDataController: SiteDataSummaryController
  sitePermissionsController: SitePermissionsController
  locale: SupportedLocale
  formatNumber: (value: number) => string
  runAction: (action: () => unknown) => unknown
  actions: BrowserAddressBarActions
  keepsSeparatePanelOpen: () => boolean
}>()

const siteControlsOpen = defineModel<boolean>('siteControlsOpen', { required: true })
const panelDock = defineModel<PanelDock>('panelDock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const siteControlsButton = ref<HTMLButtonElement | null>(null)
const {
  address,
  input,
  form,
  selection,
  suggestions,
  visible,
  selected,
  switchFocused,
  dirty,
  keyword,
  keywordHint,
  suggestionId,
  switchSuggestionId,
  suggestionMeta,
  handleFocus,
  handleInput,
  handlePaste,
  handleDragStart,
  handleDragEnd,
  handleDrop,
  handleFocusOut,
  handleKeydown,
  submit
} = props.addressController
const {
  activeWebUrl,
  activeOrigin,
  activeHostname,
  activeSitePermissions,
  activeSecurity,
  activeAddressKind,
} = props.activeTabPresentation
const { activeEmulation, resetPending, label: emulationLabel, describe: emulationDescription } = props.emulationController
const { activeNetworkRouteCount, networkConditionsUnconfirmed } = props.pageToolsPresentation
const { summary: siteDataSummary, state: siteDataState, message: siteDataMessage } = props.siteDataController
const { permissionLabel, isPending: isSitePermissionPending } = props.sitePermissionsController
// A forced :hover/:active state changes how the page looks, so the person always sees it and can end it.
const cssStatePreview = computed(() => {
  const preview = props.activeTab?.cssStatePreview
  if (!preview) return undefined
  const states = preview.states.map((state) => `:${state}`).join(' ')
  return {
    label: t(preview.resetUncertain ? 'runtime.cssStatePreview.uncertain' : 'runtime.cssStatePreview.label', { states }),
    action: t(preview.resetUncertain ? 'runtime.cssStatePreview.retry' : 'runtime.cssStatePreview.reset', { states, selector: preview.selector }),
    uncertain: preview.resetUncertain === true
  }
})

// The site controls button's name, which says first when the page is not secure, as the button shows it.
const siteControlsLabel = computed(() => {
  if (!activeWebUrl.value) return t('runtime.tabs.siteControlsUnavailable')
  return t(activeSecurity.value === 'not-secure' ? 'runtime.tabs.siteControlsNotSecure' : 'runtime.tabs.siteControls', { host: activeHostname.value })
})

// As in Chrome, "Not secure" follows the information icon only while the field shows the page's address rather than
// text you typed, and only while the address keeps room beside it. The label stays in the button, out of the layout
// while it does not show, so its width in the interface language is known before it shows; the field's own width
// already leaves out the other chips and pills beside it. It shows once measured.
const MIN_ADDRESS_ROOM = 280
// How much wider than the label the button grows with it: 5 + 18 + 4 + label + 8 pixels against its 28 alone
// (.site-controls-button.not-secure).
const SECURITY_LABEL_SPACING = 7
const securityLabel = ref<HTMLElement | null>(null)
const securityLabelFits = ref(false)
useResizeObserver(
  () => [input.value, securityLabel.value].filter((element): element is HTMLElement => Boolean(element)),
  () => {
    const field = input.value
    const label = securityLabel.value
    if (!field || !label) return
    const labelSpace = label.offsetWidth + SECURITY_LABEL_SPACING
    const taken = label.classList.contains('measured-only') ? 0 : labelSpace
    securityLabelFits.value = label.offsetWidth > 0 && field.clientWidth + taken - labelSpace >= MIN_ADDRESS_ROOM
  }
)
const securityLabelShown = computed(() => activeSecurity.value === 'not-secure' && !dirty.value && securityLabelFits.value)

// What a screen reader hears as the field offers a keyword search or takes one, as the hint and the chip show it.
const keywordStatus = computed(() => {
  if (keyword.value) return t('runtime.suggestion.keywordSearch', { engine: keyword.value.label })
  return keywordHint.value ? t('runtime.suggestion.keywordHint', { engine: keywordHint.value.label }) : ''
})

// An agent's software passkey signs in to the page for it, so the address bar shows it while its tab is shown and the person can stop it.
const virtualPasskey = computed(() => {
  const passkey = props.activeTab?.virtualPasskey
  return passkey ? { action: t('runtime.virtualPasskey.stop', { origin: passkey.origin }) } : undefined
})

// Armed logpoints pause the page at each hit and read its values, so the person sees them and can stop them.
const logpoints = computed(() => {
  const summary = props.activeTab?.logpoints
  return summary ? { action: t('runtime.logpoints.stop', { origin: summary.origin }) } : undefined
})

function run(action: () => unknown): void {
  void props.runAction(action)
}

function setSitePermission(entry: SitePermissionEntry, decision: SitePermissionDecision): boolean | Promise<boolean> {
  return props.actions.setSitePermission(entry, decision)
}

async function resetSitePermission(entry: SitePermissionEntry): Promise<boolean> {
  const tab = props.activeTab
  const context = tab
    ? { id: tab.id, url: tab.url, navigationGeneration: tab.navigationGeneration }
    : null
  const removed = await props.actions.resetSitePermission(entry)
  const activeTab = props.activeTab
  if (
    !removed
    || !siteControlsOpen.value
    || !context
    || !activeTab
    || activeTab.id !== context.id
    || activeTab.url !== context.url
    || activeTab.navigationGeneration !== context.navigationGeneration
  ) return removed
  await nextTick()
  if (!siteControlsOpen.value) return removed
  siteControlsButton.value?.focus()
  return removed
}
</script>

<template>
  <form ref="form" class="address-form" @submit.prevent="run(submit)" @focusout="handleFocusOut">
    <UiButton appearance="application"
      ref="siteControlsButton"
      class="site-controls-button"
      :class="{ active: siteControlsOpen, customized: activeSitePermissions.length > 0, 'not-secure': securityLabelShown }"
      type="button"
      v-tooltip="activeWebUrl ? siteControlsLabel : t('runtime.tabs.siteControlsAvailable')"
      :aria-label="siteControlsLabel"
      aria-controls="site-controls-panel"
      :aria-expanded="siteControlsOpen"
      :disabled="!activeWebUrl"
      @click="run(actions.toggleSiteControls)"
    >
      <!-- As in Chrome: an HTTP page shows the information icon, with "Not secure" unless it is on this computer. -->
      <IconInfo v-if="activeSecurity === 'local' || activeSecurity === 'not-secure'" aria-hidden="true" />
      <IconTune v-else aria-hidden="true" />
      <span
        v-if="activeSecurity === 'not-secure'"
        ref="securityLabel"
        class="site-security-label"
        :class="{ 'measured-only': !securityLabelShown }"
        aria-hidden="true"
      >{{ t('runtime.address.notSecure') }}</span>
      <span v-if="activeSitePermissions.length" class="site-controls-indicator" aria-hidden="true" />
    </UiButton>
    <span v-if="keyword" id="address-keyword" class="address-keyword">
      <IconSearch aria-hidden="true" />
      <span>{{ t('runtime.suggestion.keywordSearch', { engine: keyword.label }) }}</span>
    </span>
    <input
      ref="input"
      v-model="address"
      class="address"
      :aria-label="t('shell.toolbar.address')"
      role="combobox"
      aria-keyshortcuts="Control+L Meta+L"
      aria-autocomplete="both"
      aria-controls="address-suggestions address-suggestion-actions"
      :aria-expanded="visible"
      :aria-activedescendant="visible && selected ? (switchFocused ? switchSuggestionId(selected) : suggestionId(selected)) : undefined"
      :aria-describedby="keyword ? 'address-keyword' : undefined"
      autocomplete="off"
      spellcheck="false"
      :placeholder="keyword ? '' : t('shell.toolbar.addressPlaceholder')"
      @focus="handleFocus"
      @input="handleInput"
      @paste="handlePaste"
      @dragstart="handleDragStart"
      @dragend="handleDragEnd"
      @drop="handleDrop"
      @keydown="handleKeydown"
    />
    <span v-if="keywordHint" class="address-keyword-hint" aria-hidden="true">{{ t('runtime.suggestion.keywordHint', { engine: keywordHint.label }) }}</span>
    <span class="sr-only" role="status">{{ keywordStatus }}</span>
    <span v-if="activeTab?.emulationState" class="emulation-pill" role="status" v-tooltip="t('emulationApplication.help')">
      <IconSpeed aria-hidden="true" />
      <span>{{ t('emulationApplication.' + activeTab.emulationState.application) }}</span>
    </span>
    <UiButton appearance="application"
      v-if="activeEmulation"
      class="emulation-pill"
      :class="{ offline: activeEmulation.network === 'offline' }"
      type="button"
      v-tooltip="t('runtime.emulation.reset', { description: emulationDescription(activeEmulation) })"
      :aria-label="t('runtime.emulation.reset', { description: emulationDescription(activeEmulation) })"
      :disabled="resetPending"
      @click="run(actions.resetActiveTabEmulation)"
    >
      <IconSpeed aria-hidden="true" />
      <span>{{ emulationLabel(activeEmulation) }}</span>
      <IconClose aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      v-if="cssStatePreview"
      class="emulation-pill"
      :class="{ offline: cssStatePreview.uncertain }"
      data-testid="css-state-preview-pill"
      type="button"
      v-tooltip="cssStatePreview.action"
      :aria-label="cssStatePreview.action"
      @click="run(actions.clearActiveCssStatePreview)"
    >
      <IconAdsClick aria-hidden="true" />
      <span>{{ cssStatePreview.label }}</span>
      <IconClose aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      v-if="virtualPasskey"
      class="emulation-pill"
      data-testid="virtual-passkey-pill"
      type="button"
      v-tooltip="virtualPasskey.action"
      :aria-label="virtualPasskey.action"
      @click="run(actions.stopActiveVirtualPasskey)"
    >
      <IconPasskey aria-hidden="true" />
      <span>{{ t('runtime.virtualPasskey.label') }}</span>
      <IconClose aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      v-if="logpoints"
      class="emulation-pill"
      data-testid="logpoints-pill"
      type="button"
      v-tooltip="logpoints.action"
      :aria-label="logpoints.action"
      @click="run(actions.stopActiveLogpoints)"
    >
      <IconBugReport aria-hidden="true" />
      <span>{{ t('runtime.logpoints.label') }}</span>
      <IconClose aria-hidden="true" />
    </UiButton>
    <UiButton appearance="application"
      v-if="activeNetworkRouteCount || networkConditionsUnconfirmed"
      class="network-routes-pill"
      type="button"
      v-tooltip="networkConditionsUnconfirmed ? t('network.conditions.unconfirmed') : t('shell.pageTools.openRoutes', { count: formatNumber(activeNetworkRouteCount) }, activeNetworkRouteCount)"
      :aria-label="networkConditionsUnconfirmed ? t('network.conditions.unconfirmed') : t('shell.pageTools.openRoutes', { count: formatNumber(activeNetworkRouteCount) }, activeNetworkRouteCount)"
      @click="run(actions.openRequestConditions)"
    >
      <IconRoute aria-hidden="true" />
      <span>{{ networkConditionsUnconfirmed ? t('network.conditions.unconfirmed') : t('shell.pageTools.routeCount', { count: formatNumber(activeNetworkRouteCount) }, activeNetworkRouteCount) }}</span>
      <IconKeyboardArrowRight aria-hidden="true" />
    </UiButton>
    <SiteControlsPanel
      v-model:open="siteControlsOpen"
      v-model:dock="panelDock"
      :hostname="activeHostname"
      :address-kind="activeAddressKind"
      :security="activeSecurity"
      :origin="activeOrigin"
      :summary="siteDataSummary"
      :state="siteDataState"
      :message="siteDataMessage"
      :permissions="activeSitePermissions"
      :locale="locale"
      :permission-label="permissionLabel"
      :permission-pending="isSitePermissionPending"
      :set-permission="setSitePermission"
      :reset-permission="resetSitePermission"
      :open-permission-settings="actions.openSitePermissionSettings"
      :open-privacy-settings="actions.openSitePrivacySettings"
      :refresh="siteDataController.refresh"
      :keeps-separate-panel-open="keepsSeparatePanelOpen"
    />
    <section
      v-if="visible"
      id="address-suggestions"
      class="sr-only"
      role="listbox"
      :aria-label="t('shell.suggestions')"
    >
      <span
        v-for="(suggestion, index) in suggestions"
        :id="suggestionId(suggestion)"
        :key="suggestion.id"
        role="option"
        :aria-selected="index === selection"
      >{{ suggestion.title }} {{ suggestion.url }} {{ suggestionMeta(suggestion) }}<template v-if="hasSwitchToTabButton(suggestion)">{{ ' ' + t('runtime.suggestion.switchHint') }}</template></span>
    </section>
    <!-- Tab goes on to a row's Switch to this tab button, as in Chrome's address bar. The buttons sit outside the list, so
         it still counts only the rows. -->
    <div v-if="visible" id="address-suggestion-actions" class="sr-only">
      <template v-for="suggestion in suggestions" :key="suggestion.id">
        <span
          v-if="hasSwitchToTabButton(suggestion)"
          :id="switchSuggestionId(suggestion)"
          role="button"
        >{{ t('runtime.suggestion.switchToTab') }}: {{ suggestion.title }}</span>
      </template>
    </div>
  </form>
</template>
