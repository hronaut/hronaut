<script setup lang="ts">
import type { AppSettingsFeatureController } from '../composables/useAppSettingsFeatureController.js'
import type { HelpDialogController } from '../composables/useHelpDialogController.js'
import HelpDialog from './HelpDialog.vue'
import SettingsDialog from './SettingsDialog.vue'
import WalletApprovalDialog from './WalletApprovalDialog.vue'

const props = defineProps<{
  settingsController: AppSettingsFeatureController
  helpController: HelpDialogController
  workspaces: Array<{ id: string; name: string }>
  formatBytes: (bytes: number) => string
  formatNumber: (value: number) => string
  formatDateTime: (value: Date | number | string) => string
  testSound: () => void
  reportSettingError: (error: unknown) => void
  openUrl: (url: string) => Promise<void>
  purchaseCommercialLicense: () => void
  openSupportSettings: () => void
  reportLayout: () => void
}>()

const {
  searchSettingsController,
  downloadSettingsController,
  performanceSettingsController,
  mcpSettingsController,
  privacySettingsController,
  sitePermissionsController,
  credentialsController,
  updateSettingsController,
  commercialLicenseController,
  settingsDialogController,
  walletsController
} = props.settingsController
const { state: updateState } = updateSettingsController
</script>

<template>
  <SettingsDialog
    :controller="settingsDialogController"
    :search-controller="searchSettingsController"
    :download-controller="downloadSettingsController"
    :performance-controller="performanceSettingsController"
    :mcp-controller="mcpSettingsController"
    :privacy-controller="privacySettingsController"
    :permissions-controller="sitePermissionsController"
    :credentials-controller="credentialsController"
    :update-controller="updateSettingsController"
    :support-controller="commercialLicenseController"
    :wallets-controller="walletsController"
    :workspaces="workspaces"
    :format-bytes="formatBytes"
    :format-number="formatNumber"
    :format-date-time="formatDateTime"
    :test-sound="testSound"
    :report-setting-error="reportSettingError"
    :open-url="openUrl"
    :purchase-commercial-license="purchaseCommercialLicense"
  />
  <WalletApprovalDialog :controller="walletsController" />
  <HelpDialog
    :controller="helpController"
    :current-version="updateState.currentVersion"
    :open-url="openUrl"
    :open-support-settings="openSupportSettings"
    :report-layout="reportLayout"
  />
</template>
