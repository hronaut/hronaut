<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconBedtime from '~icons/material-symbols/bedtime-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconContrast from '~icons/material-symbols/contrast-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconFavorite from '~icons/material-symbols/favorite-rounded'
import IconKey from '~icons/material-symbols/key-rounded'
import IconPrivacy from '~icons/material-symbols/privacy-tip-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconShieldLock from '~icons/material-symbols/shield-lock-rounded'
import IconSystemUpdate from '~icons/material-symbols/system-update-alt-rounded'
import type { CommercialLicenseController } from '../composables/useCommercialLicenseController.js'
import type { CredentialsController } from '../composables/useCredentialsController.js'
import type { DownloadSettingsController } from '../composables/useDownloadSettingsController.js'
import type { McpSettingsController } from '../composables/useMcpSettingsController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'
import type { PerformanceSettingsController } from '../composables/usePerformanceSettingsController.js'
import type { PrivacySettingsController } from '../composables/usePrivacySettingsController.js'
import type { SearchSettingsController } from '../composables/useSearchSettingsController.js'
import type { SettingsDialogController, SettingsSection } from '../composables/useSettingsDialogController.js'
import type { SitePermissionsController } from '../composables/useSitePermissionsController.js'
import type { UpdateSettingsController } from '../composables/useUpdateSettingsController.js'
import AppearanceSettings from './AppearanceSettings.vue'
import CredentialsSettingsPanel from './CredentialsSettingsPanel.vue'
import DownloadSettingsPanel from './DownloadSettingsPanel.vue'
import McpSettingsPanel from './McpSettingsPanel.vue'
import PerformanceSettingsPanel from './PerformanceSettingsPanel.vue'
import PrivacySettingsPanel from './PrivacySettingsPanel.vue'
import SearchSettingsPanel from './SearchSettingsPanel.vue'
import SitePermissionsSettingsPanel from './SitePermissionsSettingsPanel.vue'
import SupportSettingsPanel from './SupportSettingsPanel.vue'
import UpdateSettingsPanel from './UpdateSettingsPanel.vue'

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
  supportController: CommercialLicenseController
  formatBytes: (bytes: number) => string
  formatNumber: (value: number) => string
  formatDateTime: (value: Date | number | string) => string
  testSound: () => void
  reportSettingError: (error: unknown) => void
  openUrl: (url: string) => Promise<void>
  purchaseCommercialLicense: () => void
}>()

const { t } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const {
  open,
  section,
  resetVisible,
  resetDisabled,
  close,
  resetCurrent
} = props.controller

const navigation = computed<Array<{
  section: SettingsSection
  label: string
  description: string
  icon: typeof IconContrast
}>>(() => [
  { section: 'appearance', label: t('settings.nav.appearance'), description: t('settings.nav.appearanceDescription'), icon: IconContrast },
  { section: 'search', label: t('settings.nav.search'), description: t('settings.nav.searchDescription'), icon: IconSearch },
  { section: 'downloads', label: t('settings.nav.downloads'), description: t('settings.nav.downloadsDescription'), icon: IconDownload },
  { section: 'performance', label: t('settings.nav.performance'), description: t('settings.nav.performanceDescription'), icon: IconBedtime },
  { section: 'mcp', label: t('settings.nav.mcp'), description: t('settings.nav.mcpDescription'), icon: IconShieldLock },
  { section: 'privacy', label: t('settings.nav.privacy'), description: t('settings.nav.privacyDescription'), icon: IconDelete },
  { section: 'permissions', label: t('settings.nav.permissions'), description: t('settings.nav.permissionsDescription'), icon: IconPrivacy },
  { section: 'credentials', label: t('settings.nav.passwords'), description: t('settings.nav.passwordsDescription'), icon: IconKey },
  { section: 'updates', label: t('settings.nav.updates'), description: t('settings.nav.updatesDescription'), icon: IconSystemUpdate },
  { section: 'support', label: t('settings.nav.support'), description: t('settings.nav.supportDescription'), icon: IconFavorite }
])

useModalDialogFocus({ open, panel })
</script>

<template>
  <div v-if="open" class="settings-overlay" @click.self="close">
    <section
      ref="panel"
      class="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      tabindex="-1"
    >
      <div class="settings-header">
        <div>
          <span class="eyebrow">{{ t('settings.kicker') }}</span>
          <h2 id="settings-title">{{ t('settings.heading') }}</h2>
        </div>
        <button class="panel-close" type="button" :aria-label="t('settings.close')" @click="close"><IconClose aria-hidden="true" /></button>
      </div>

      <div class="settings-layout">
        <nav class="settings-sidebar" :aria-label="t('settings.sections')">
          <button
            v-for="item in navigation"
            :key="item.section"
            class="settings-nav-item"
            :class="{ active: section === item.section }"
            type="button"
            :aria-current="section === item.section ? 'page' : undefined"
            @click="section = item.section"
          >
            <span class="settings-nav-icon" aria-hidden="true"><component :is="item.icon" /></span>
            <span>
              <strong>{{ item.label }}</strong>
              <small>{{ item.description }}</small>
            </span>
          </button>
        </nav>

        <AppearanceSettings
          v-if="section === 'appearance'"
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
        />
        <McpSettingsPanel
          v-else-if="section === 'mcp'"
          :controller="mcpController"
        />
        <PrivacySettingsPanel
          v-else-if="section === 'privacy'"
          :controller="privacyController"
          :format-bytes="formatBytes"
          :format-number="formatNumber"
        />
        <SitePermissionsSettingsPanel
          v-else-if="section === 'permissions'"
          :controller="permissionsController"
        />
        <CredentialsSettingsPanel
          v-else-if="section === 'credentials'"
          :controller="credentialsController"
        />
        <UpdateSettingsPanel
          v-else-if="section === 'updates'"
          :controller="updateController"
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

      <footer class="settings-footer">
        <button
          v-if="resetVisible"
          class="secondary-button"
          type="button"
          :disabled="resetDisabled"
          @click="resetCurrent"
        >{{ t('settings.reset') }}</button>
        <button class="primary-button" type="button" @click="close">{{ t('common.close') }}</button>
      </footer>
    </section>
  </div>
</template>
