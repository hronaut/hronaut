<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconKeyboardArrowRight from '~icons/material-symbols/keyboard-arrow-right-rounded'
import IconRoute from '~icons/material-symbols/route-rounded'
import IconSpeed from '~icons/material-symbols/speed-rounded'
import IconTune from '~icons/material-symbols/tune-rounded'
import type {
  PanelDock,
  SitePermissionDecision,
  SitePermissionEntry,
  SupportedLocale
} from '../../../shared/types.js'
import type { ActiveTabPresentationController } from '../composables/useActiveTabPresentationController.js'
import type { AddressBarController } from '../composables/useAddressBarController.js'
import type { EmulationController } from '../composables/useEmulationController.js'
import type { PageToolsPresentationController } from '../composables/usePageToolsPresentationController.js'
import type { SiteDataSummaryController } from '../composables/useSiteDataSummaryController.js'
import type { SitePermissionsController } from '../composables/useSitePermissionsController.js'
import SiteControlsPanel from './SiteControlsPanel.vue'

export interface BrowserAddressBarActions {
  toggleSiteControls: () => unknown
  resetActiveTabEmulation: () => unknown
  openRequestConditions: () => unknown
  setSitePermission: (entry: SitePermissionEntry, decision: SitePermissionDecision) => boolean | Promise<boolean>
  resetSitePermission: (entry: SitePermissionEntry) => boolean | Promise<boolean>
  openSitePermissionSettings: () => void
  openSitePrivacySettings: () => void | Promise<void>
}

const props = defineProps<{
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
  suggestionId,
  suggestionMeta,
  handleFocus,
  handleInput,
  handleFocusOut,
  handleKeydown,
  submit
} = props.addressController
const {
  activeWebUrl,
  activeOrigin,
  activeHostname,
  activeSitePermissions,
  activeAddressKind,
  activeTabUsesDefaultProfile
} = props.activeTabPresentation
const { activeEmulation, resetPending, label: emulationLabel, describe: emulationDescription } = props.emulationController
const { activeNetworkRouteCount } = props.pageToolsPresentation
const { summary: siteDataSummary, state: siteDataState, message: siteDataMessage } = props.siteDataController
const { permissionLabel, isPending: isSitePermissionPending } = props.sitePermissionsController

function run(action: () => unknown): void {
  void props.runAction(action)
}

async function resetSitePermission(entry: SitePermissionEntry): Promise<boolean> {
  const removed = await props.actions.resetSitePermission(entry)
  await nextTick()
  siteControlsOpen.value = true
  await nextTick()
  siteControlsButton.value?.focus()
  return removed
}
</script>

<template>
  <form ref="form" class="address-form" @submit.prevent="run(submit)" @focusout="handleFocusOut">
    <button
      ref="siteControlsButton"
      class="site-controls-button"
      :class="{ active: siteControlsOpen, customized: activeSitePermissions.length > 0 }"
      type="button"
      :title="activeWebUrl ? t('runtime.tabs.siteControls', { host: activeHostname }) : t('runtime.tabs.siteControlsAvailable')"
      :aria-label="activeWebUrl ? t('runtime.tabs.siteControls', { host: activeHostname }) : t('runtime.tabs.siteControlsUnavailable')"
      aria-controls="site-controls-panel"
      :aria-expanded="siteControlsOpen"
      :disabled="!activeWebUrl"
      @click="run(actions.toggleSiteControls)"
    >
      <IconTune aria-hidden="true" />
      <span v-if="activeSitePermissions.length" class="site-controls-indicator" aria-hidden="true" />
    </button>
    <input
      ref="input"
      v-model="address"
      class="address"
      :aria-label="t('shell.toolbar.address')"
      role="combobox"
      aria-keyshortcuts="Control+L Meta+L"
      aria-autocomplete="list"
      aria-controls="address-suggestions"
      :aria-expanded="visible"
      :aria-activedescendant="visible && selected ? suggestionId(selected) : undefined"
      autocomplete="off"
      spellcheck="false"
      :placeholder="t('shell.toolbar.addressPlaceholder')"
      @focus="handleFocus"
      @input="handleInput"
      @keydown="handleKeydown"
    />
    <button
      v-if="activeEmulation"
      class="emulation-pill"
      :class="{ offline: activeEmulation.network === 'offline' }"
      type="button"
      :title="t('runtime.emulation.reset', { description: emulationDescription(activeEmulation) })"
      :aria-label="t('runtime.emulation.reset', { description: emulationDescription(activeEmulation) })"
      :disabled="resetPending"
      @click="run(actions.resetActiveTabEmulation)"
    >
      <IconSpeed aria-hidden="true" />
      <span>{{ emulationLabel(activeEmulation) }}</span>
      <IconClose aria-hidden="true" />
    </button>
    <button
      v-if="activeNetworkRouteCount"
      class="network-routes-pill"
      type="button"
      :title="t('shell.pageTools.openRoutes', { count: formatNumber(activeNetworkRouteCount) }, activeNetworkRouteCount)"
      :aria-label="t('shell.pageTools.openRoutes', { count: formatNumber(activeNetworkRouteCount) }, activeNetworkRouteCount)"
      @click="run(actions.openRequestConditions)"
    >
      <IconRoute aria-hidden="true" />
      <span>{{ t('shell.pageTools.routeCount', { count: formatNumber(activeNetworkRouteCount) }, activeNetworkRouteCount) }}</span>
      <IconKeyboardArrowRight aria-hidden="true" />
    </button>
    <SiteControlsPanel
      v-model:open="siteControlsOpen"
      v-model:dock="panelDock"
      :hostname="activeHostname"
      :address-kind="activeAddressKind"
      :origin="activeOrigin"
      :summary="siteDataSummary"
      :state="siteDataState"
      :message="siteDataMessage"
      :permissions="activeSitePermissions"
      :uses-default-profile="activeTabUsesDefaultProfile"
      :locale="locale"
      :permission-label="permissionLabel"
      :permission-pending="isSitePermissionPending"
      :set-permission="actions.setSitePermission"
      :reset-permission="resetSitePermission"
      :open-permission-settings="actions.openSitePermissionSettings"
      :open-privacy-settings="actions.openSitePrivacySettings"
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
      >{{ suggestion.title }} {{ suggestion.url }} {{ suggestionMeta(suggestion) }}</span>
    </section>
  </form>
</template>
