<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconPrivacy from '~icons/material-symbols/privacy-tip-rounded'
import IconTune from '~icons/material-symbols/tune-rounded'
import { formatNumber } from '../../../shared/format'
import type {
  BrowsingDataSiteSummary,
  PanelDock,
  SitePermissionDecision,
  SitePermissionEntry,
  SupportedLocale
} from '../../../shared/types'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  hostname: string
  addressKind: string
  origin: string | null
  summary: BrowsingDataSiteSummary | null
  state: 'idle' | 'loading' | 'error'
  message: string
  permissions: SitePermissionEntry[]
  usesDefaultProfile: boolean
  locale: SupportedLocale
  permissionLabel: (permission: string) => string
  permissionPending: (entry: SitePermissionEntry) => boolean
  setPermission: (entry: SitePermissionEntry, decision: SitePermissionDecision) => boolean | Promise<boolean>
  resetPermission: (entry: SitePermissionEntry) => boolean | Promise<boolean>
  openPermissionSettings: () => void
  openPrivacySettings: () => void | Promise<void>
}>()

const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const localNumber = (value: number): string => formatNumber(props.locale, value)

async function changePermission(entry: SitePermissionEntry, event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const decision = input.value as SitePermissionDecision
  if (!(await props.setPermission(entry, decision))) input.value = entry.decision
}
</script>

<template>
  <section
    v-if="open"
    id="site-controls-panel"
    class="site-controls-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="site-controls-title"
  >
    <header>
      <span class="site-controls-mark" aria-hidden="true"><IconTune /></span>
      <span class="site-controls-heading">
        <strong id="site-controls-title">{{ hostname }}</strong>
        <small>{{ addressKind }} · {{ origin }}</small>
      </span>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('runtime.tabs.dockSiteControls')" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('shell.siteControls.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div class="site-data-summary" :aria-busy="state === 'loading'">
      <article :aria-label="summary ? t('runtime.tabs.cookieAvailable', { count: localNumber(summary.cookieCount) }, summary.cookieCount) : t('runtime.tabs.loadingCookies')">
        <IconPrivacy aria-hidden="true" />
        <span><strong>{{ summary?.cookieCount ?? '…' }}</strong><small>{{ summary?.cookieCount === 1 ? t('shell.siteControls.cookie') : t('shell.siteControls.cookies') }}</small></span>
      </article>
      <article :aria-label="summary ? t('runtime.tabs.historyAvailable', { pages: localNumber(summary.historyEntries), visits: localNumber(summary.historyVisits) }, summary.historyEntries) : t('runtime.tabs.loadingHistory')">
        <IconHistory aria-hidden="true" />
        <span><strong>{{ summary?.historyEntries ?? '…' }}</strong><small>{{ summary?.historyEntries === 1 ? t('shell.siteControls.historyPage') : t('shell.siteControls.historyPages') }}<template v-if="summary"> · {{ summary.historyVisits }} {{ summary.historyVisits === 1 ? t('shell.siteControls.visit') : t('shell.siteControls.visits') }}</template></small></span>
      </article>
    </div>
    <output v-if="state === 'error'" class="site-controls-error" aria-live="polite">{{ message }}</output>
    <section class="site-permission-controls" aria-labelledby="site-permission-controls-title">
      <div class="site-controls-section-heading">
        <strong id="site-permission-controls-title">{{ t('shell.siteControls.permissions') }}</strong>
        <span>{{ permissions.length ? `${permissions.length} customized` : t('shell.siteControls.defaults') }}</span>
      </div>
      <div v-if="permissions.length" class="site-permission-list">
        <div v-for="permission in permissions" :key="permission.permission" class="site-permission-control">
          <label :for="`site-control-${permission.permission}`">{{ permissionLabel(permission.permission) }}</label>
          <select
            :id="`site-control-${permission.permission}`"
            :value="permission.decision"
            :disabled="permissionPending(permission)"
            :aria-label="t('runtimeActions.permission.aria', { permission: permissionLabel(permission.permission), origin: permission.origin })"
            @change="changePermission(permission, $event)"
          >
            <option value="allow">{{ t('shell.siteControls.allow') }}</option>
            <option value="deny">{{ t('shell.siteControls.block') }}</option>
          </select>
          <UiButton appearance="application" type="button" :aria-label="t('runtimeActions.permission.resetAria', { permission: permissionLabel(permission.permission), origin: permission.origin })" :title="t('shell.siteControls.reset')" :disabled="permissionPending(permission)" @click="resetPermission(permission)"><IconClose aria-hidden="true" /></UiButton>
        </div>
      </div>
      <p v-else>{{ t('shell.siteControls.empty') }}</p>
    </section>
    <footer>
      <UiButton appearance="application" class="site-controls-secondary" type="button" @click="openPermissionSettings">{{ t('shell.siteControls.allSettings') }}</UiButton>
      <UiButton appearance="application" variant="primary" class="site-controls-primary" type="button" @click="openPrivacySettings">{{ usesDefaultProfile ? t('shell.siteControls.clearData') : t('panels.siteStorage') }}</UiButton>
    </footer>
  </section>
</template>
