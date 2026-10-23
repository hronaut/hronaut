<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { watch } from 'vue'
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
import { vTooltip } from '../ui/tooltip.js'

const props = defineProps<{
  hostname: string
  addressKind: string
  origin: string | null
  summary: BrowsingDataSiteSummary | null
  state: 'idle' | 'loading' | 'error'
  message: string
  permissions: SitePermissionEntry[]
  locale: SupportedLocale
  permissionLabel: (permission: string) => string
  permissionPending: (entry: SitePermissionEntry) => boolean
  setPermission: (entry: SitePermissionEntry, decision: SitePermissionDecision) => boolean | Promise<boolean>
  resetPermission: (entry: SitePermissionEntry) => boolean | Promise<boolean>
  openPermissionSettings: () => void
  openPrivacySettings: () => void | Promise<void>
  refresh: () => unknown
  keepsSeparatePanelOpen: () => boolean
}>()

const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const localNumber = (value: number): string => formatNumber(props.locale, value)

// Docked back from its window after the page changed, the main window had cleared the site's counts for the new page
// while the panel was away, and showed "…" until it was opened again. It reads them now. The closing panel window
// reads nothing.
watch(dock, (next, previous) => {
  if (open.value && previous === 'window' && next !== 'window' && !props.keepsSeparatePanelOpen() && !props.summary && props.state === 'idle') void props.refresh()
})

/** What tells a decision apart from the page's own decisions in this workspace: a website embedded in the page shows its origin. */
function permissionDetail(entry: SitePermissionEntry): string {
  return entry.embeddedIn ? entry.origin : ''
}

/** A row's place in the list: its website, permission and embedding site. */
function rowKey(entry: SitePermissionEntry): string {
  return [entry.origin, entry.permission, entry.embeddedIn ?? ''].join('\u0000')
}

/** The accessible name of a row's control, which also says when the decision is for a website embedded in this page. */
function controlLabel(entry: SitePermissionEntry, kind: 'select' | 'reset'): string {
  const permission = props.permissionLabel(entry.permission)
  const scope = entry.embeddedIn ? t('settings.permissions.embeddedIn', { site: entry.embeddedIn }) : ''
  if (!scope) {
    return t(kind === 'select' ? 'runtimeActions.permission.aria' : 'runtimeActions.permission.resetAria', { permission, origin: entry.origin })
  }
  return t(kind === 'select' ? 'runtimeActions.permission.scopedAria' : 'runtimeActions.permission.scopedResetAria', {
    permission,
    origin: entry.origin,
    scope
  })
}

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
        <span><strong>{{ summary?.cookieCount ?? '…' }}</strong><small>{{ t('shell.siteControls.cookies', summary?.cookieCount ?? 0) }}</small></span>
      </article>
      <article :aria-label="summary ? t('runtime.tabs.historyAvailable', { pages: t('runtime.tabs.historyPages', { count: localNumber(summary.historyEntries) }, summary.historyEntries), visits: t('runtime.tabs.historyVisits', { count: localNumber(summary.historyVisits) }, summary.historyVisits) }) : t('runtime.tabs.loadingHistory')">
        <IconHistory aria-hidden="true" />
        <span><strong>{{ summary?.historyEntries ?? '…' }}</strong><small>{{ t('shell.siteControls.historyPages', summary?.historyEntries ?? 0) }}<template v-if="summary"> · {{ summary.historyVisits }} {{ t('shell.siteControls.visits', summary.historyVisits) }}</template></small></span>
      </article>
    </div>
    <output v-if="state === 'error'" class="site-controls-error" aria-live="polite">{{ message }}</output>
    <section class="site-permission-controls" aria-labelledby="site-permission-controls-title">
      <div class="site-controls-section-heading">
        <strong id="site-permission-controls-title">{{ t('shell.siteControls.permissions') }}</strong>
        <span>{{ permissions.length ? t('shell.siteControls.customized', { count: localNumber(permissions.length) }, permissions.length) : t('shell.siteControls.defaults') }}</span>
      </div>
      <div v-if="permissions.length" class="site-permission-list">
        <div v-for="(permission, index) in permissions" :key="rowKey(permission)" class="site-permission-control">
          <label :for="`site-control-${index}`">
            {{ permissionLabel(permission.permission) }}
            <small v-if="permissionDetail(permission)">{{ permissionDetail(permission) }}</small>
          </label>
          <select
            :id="`site-control-${index}`"
            :value="permission.decision"
            :disabled="permissionPending(permission)"
            :aria-label="controlLabel(permission, 'select')"
            @change="changePermission(permission, $event)"
          >
            <option value="allow">{{ t('shell.siteControls.allow') }}</option>
            <option value="deny">{{ t('shell.siteControls.block') }}</option>
          </select>
          <!-- Forgetting a decision for all workspaces would forget it in every one, so only Settings offers that. -->
          <UiButton appearance="application" type="button" :aria-label="controlLabel(permission, 'reset')" v-tooltip="t('shell.siteControls.reset')" :disabled="permissionPending(permission)" @click="resetPermission(permission)"><IconClose aria-hidden="true" /></UiButton>
        </div>
      </div>
      <p v-else>{{ t('shell.siteControls.empty') }}</p>
    </section>
    <footer>
      <UiButton appearance="application" class="site-controls-secondary" type="button" @click="openPermissionSettings">{{ t('shell.siteControls.allSettings') }}</UiButton>
      <UiButton appearance="application" variant="primary" class="site-controls-primary" type="button" @click="openPrivacySettings">{{ t('panels.siteStorage') }}</UiButton>
    </footer>
  </section>
</template>
