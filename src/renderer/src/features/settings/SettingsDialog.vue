<script setup lang="ts">
import UiButton from "../../ui/UiButton.vue"
import UiOverlayTransition from "../../ui/UiOverlayTransition.vue"
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import type { CommercialLicenseController } from './support/useCommercialLicenseController.js'
import type { CredentialsController } from '../credentials/useCredentialsController.js'
import type { DownloadSettingsController } from '../downloads/useDownloadSettingsController.js'
import type { McpSettingsController } from '../mcp/useMcpSettingsController.js'
import { applicationHasFocus } from '../../composables/useModalDialogFocus.js'
import { SETTINGS_NAVIGATION } from '../../settings-navigation.js'
import type { PerformanceSettingsController } from './usePerformanceSettingsController.js'
import type { PrivacySettingsController } from './usePrivacySettingsController.js'
import type { ReleaseHistoryController } from '../updates/useReleaseHistoryController.js'
import type { SearchSettingsController } from './useSearchSettingsController.js'
import type { SettingsDialogController, SettingsSection } from './useSettingsDialogController.js'
import type { SitePermissionsController } from '../site-controls/useSitePermissionsController.js'
import type { UpdateSettingsController } from '../updates/useUpdateSettingsController.js'
import type { WalletsController } from '../wallets/useWalletsController.js'
import { useSettingsSectionSearch } from './useSettingsSectionSearch.js'
import SettingsNavigation from './SettingsNavigation.vue'
import AppearanceSettings from './AppearanceSettings.vue'
import GeneralSettings from './GeneralSettings.vue'
import CredentialsSettingsPanel from '../credentials/CredentialsSettingsPanel.vue'
import DownloadSettingsPanel from '../downloads/DownloadSettingsPanel.vue'
import McpSettingsPanel from '../mcp/McpSettingsPanel.vue'
import PerformanceSettingsPanel from './PerformanceSettingsPanel.vue'
import PrivacySettingsPanel from './PrivacySettingsPanel.vue'
import SearchSettingsPanel from './SearchSettingsPanel.vue'
import SitePermissionsSettingsPanel from '../site-controls/SitePermissionsSettingsPanel.vue'
import SupportSettingsPanel from './support/SupportSettingsPanel.vue'
import UpdateSettingsPanel from '../updates/UpdateSettingsPanel.vue'
import WalletsSettingsPanel from '../wallets/WalletsSettingsPanel.vue'

const props = defineProps<{
  controller: SettingsDialogController
  searchController: SearchSettingsController
  downloadController: DownloadSettingsController
  performanceController: PerformanceSettingsController
  mcpController: McpSettingsController
  privacyController: PrivacySettingsController
  permissionsController: SitePermissionsController
  credentialsController: CredentialsController
  updateController: UpdateSettingsController
  releaseHistoryController: ReleaseHistoryController
  supportController: CommercialLicenseController
  walletsController: WalletsController
  workspaces: Array<{ id: string; name: string }>
  dataWorkspaces: Array<{ id: string; name: string; archived: boolean; tabCount: number; storageOriginCount: number }>
  formatBytes: (bytes: number) => string
  formatNumber: (value: number) => string
  formatDateTime: (value: Date | number | string) => string
  testSound: () => void
  reportSettingError: (error: unknown) => void
  openUrl: (url: string) => Promise<void>
  purchaseCommercialLicense: () => void
}>()
const emit = defineEmits<{
  manageWorkspace: [workspaceId: string]
  createWorkspace: []
  transferWorkspaceData: [workspaceId?: string]
}>()

const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const {
  open,
  section,
  resetBusy,
  resetVisible,
  resetDisabled,
  closeTab: close,
  resetCurrent
} = props.controller

const navigation = computed<Array<{
  section: SettingsSection
  label: string
  description: string
  keywords: string
  icon: Component
}>>(() => SETTINGS_NAVIGATION.map((item) => ({
  section: item.section,
  label: t(item.labelKey),
  description: t(item.descriptionKey),
  keywords: t(`settingsSections.keywords.${item.section}`),
  icon: item.icon
})))

const { query, matches, searchKeydown } = useSettingsSectionSearch(navigation, section)

/**
 * Reset to default disables itself and the section while it runs, so Chromium moves its focus to the document body.
 * Give it back once the reset is done, or else to Settings itself, unless you moved it meanwhile or Settings closed.
 */
async function resetWithFocus(event: Event): Promise<void> {
  const button = event.currentTarget instanceof HTMLElement && document.activeElement === event.currentTarget
    ? event.currentTarget : null
  const dialog = panel.value
  await resetCurrent()
  await nextTick()
  if (!button || !dialog || !open.value || dialog !== panel.value || !dialog.isConnected || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== button) return
  const target = button.isConnected && !button.matches(':disabled') ? button : dialog
  target.focus({ preventScroll: true })
}

watch(open, async (active, _previous, onCleanup) => {
  if (!active) { query.value = ''; return }
  let current = true
  onCleanup(() => { current = false })
  if (await applicationHasFocus() && current) panel.value?.focus({ preventScroll: true })
}, { flush: 'post' })
</script>

<template>
  <UiOverlayTransition>
    <div v-if="open" class="settings-overlay settings-page-overlay">
      <section
        ref="panel"
        id="settings-page"
        class="settings-dialog"
        role="tabpanel"
        :aria-label="t('settings.heading')"
        tabindex="-1"
      >
        <div class="settings-header">
          <label class="settings-search">
            <IconSearch aria-hidden="true" />
            <input v-model="query" type="search" :disabled="resetBusy" :aria-label="t('settings.searchSections')" :placeholder="t('settings.searchSections')" autocomplete="off" aria-controls="settings-sections" @keydown="searchKeydown">
          </label>
          <div class="settings-header-actions">
            <UiButton
              v-if="resetVisible"
              class="secondary-button"
              type="button"
              :disabled="resetDisabled"
              @click="resetWithFocus"
            >{{ t('settings.reset') }}</UiButton>
            <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('settings.close')" @click="close"><IconClose aria-hidden="true" /></UiButton>
          </div>
        </div>

        <div
          class="settings-layout"
          :aria-busy="resetBusy"
          :inert="resetBusy ? true : undefined"
        >
          <SettingsNavigation v-model="section" :items="matches" />

          <AppearanceSettings
            v-if="section === 'appearance'"
            @setting-error="reportSettingError"
          />
          <GeneralSettings
            v-else-if="section === 'general'"
            @test-sound="testSound"
            @setting-error="reportSettingError"
          />
          <SearchSettingsPanel
            v-else-if="section === 'search'"
            :controller="searchController"
          />
          <DownloadSettingsPanel
            v-else-if="section === 'downloads'"
            :controller="downloadController"
          />
          <PerformanceSettingsPanel
            v-else-if="section === 'performance'"
            :controller="performanceController"
            :format-number="formatNumber"
            @setting-error="reportSettingError"
          />
          <McpSettingsPanel
            v-else-if="section === 'mcp'"
            :controller="mcpController"
          />
          <PrivacySettingsPanel
            v-else-if="section === 'privacy'"
            :controller="privacyController"
            :workspaces="dataWorkspaces"
            :format-bytes="formatBytes"
            :format-number="formatNumber"
            @manage-workspace="emit('manageWorkspace', $event)"
            @create-workspace="emit('createWorkspace')"
            @transfer-workspace-data="emit('transferWorkspaceData', $event)"
            @setting-error="reportSettingError"
          />
          <SitePermissionsSettingsPanel
            v-else-if="section === 'permissions'"
            :controller="permissionsController"
          />
          <CredentialsSettingsPanel
            v-else-if="section === 'credentials'"
            :controller="credentialsController"
          />
          <WalletsSettingsPanel
            v-else-if="section === 'wallets'"
            :controller="walletsController"
            :workspaces="workspaces"
          />
          <UpdateSettingsPanel
            v-else-if="section === 'updates'"
            :controller="updateController"
            :release-history-controller="releaseHistoryController"
          />
          <SupportSettingsPanel
            v-else
            :controller="supportController"
            :format-number="formatNumber"
            :format-date-time="formatDateTime"
            @open-url="openUrl"
            @purchase="purchaseCommercialLicense"
          />
        </div>
      </section>
    </div>
  </UiOverlayTransition>
</template>
