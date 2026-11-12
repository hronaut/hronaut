<script setup lang="ts">
import UiIconButton from "../../ui/UiIconButton.vue"
import { UiButton, UiCheckbox, UiTabs } from '../../ui/index.js'
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ignoreHeldEnter } from '../../held-enter.js'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconPrivacy from '~icons/material-symbols/privacy-tip-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { formatNumber } from '../../../../shared/format'
import { SITE_SOUND_PERMISSION } from '../../../../shared/site-permission-names'
import { SITE_PERMISSIONS_ALLOWED_WITHOUT_ASKING, SITE_PERMISSIONS_ASKED_FIRST } from '../../../../shared/site-permission-defaults'
import type { SitePermissionDecision, SitePermissionEntry, SupportedLocale } from '../../../../shared/types'
import type { SitePermissionsController } from './useSitePermissionsController'

const props = defineProps<{
  controller: SitePermissionsController
}>()

const { t, locale } = useI18n({ useScope: 'global' })
const {
  groups,
  clearing,
  errorMessage,
  permissionLabel,
  scopeLabel,
  permissionKey,
  isPending,
  setDecision,
  remove,
  fileSavingEnabled,
  fileSavingPending,
  setFileSaving,
  blockedByDefault,
  defaultsPending,
  isBlockedByDefault,
  setBlockedByDefault,
  resetDefaults
} = props.controller

const panelRoot = ref<HTMLElement | null>(null)
// The saved decisions come first, as Settings opens here from a website's Site controls; the defaults have their own tab.
const activeTab = ref<'websites' | 'defaults'>('websites')
const settingsTabs = computed(() => [
  { id: 'websites', label: t('settings.permissions.websitesTab') },
  { id: 'defaults', label: t('settings.permissions.defaultsTab') }
])
/**
 * What every website gets for each permission, in two groups as Chrome's Site settings shows them: the permissions
 * websites ask for first, which the person can block, and those allowed without asking, which the person can block, or
 * for Sound mute.
 */
const defaultGroups = computed(() => [
  { id: 'asked', heading: t('settings.permissions.askedFirst'), permissions: SITE_PERMISSIONS_ASKED_FIRST, builtIn: t('settings.permissions.ask') },
  {
    id: 'allowed',
    heading: t('settings.permissions.allowedWithoutAsking'),
    permissions: [...SITE_PERMISSIONS_ALLOWED_WITHOUT_ASKING, SITE_SOUND_PERMISSION],
    builtIn: t('settings.permissions.allow')
  }
])
const search = ref('')
const filteredGroups = computed(() => {
  const terms = search.value.toLocaleLowerCase(locale.value).trim().split(/\s+/).filter(Boolean)
  if (!terms.length) return groups.value
  return groups.value.flatMap(group => {
    const permissions = group.permissions.filter(entry => {
      // Where the decision applies is searchable too: its row names its workspace and the website it was embedded in.
      const text = [group.origin, entry.permission, permissionLabel(entry.permission), scopeLabel(entry)]
        .join('\n').toLocaleLowerCase(locale.value)
      return terms.every(term => text.includes(term))
    })
    return permissions.length ? [{ ...group, permissions }] : []
  })
})
const totalCount = computed(() => groups.value.reduce((sum, group) => sum + group.permissions.length, 0))
const visibleCount = computed(() => filteredGroups.value.reduce((sum, group) => sum + group.permissions.length, 0))
const localNumber = (value: number): string => formatNumber(locale.value as SupportedLocale, value)

// Track row identity before Vue removes or moves the focused control. The same
// path covers Forget and authoritative permission updates across site groups.
watch(() => filteredGroups.value.flatMap(group => group.permissions.map(entry =>
  permissionKey(entry)
)).join('\n'), async (_current, _previous, onCleanup) => {
  const panel = panelRoot.value
  const focused = document.activeElement
  if (!panel || !(focused instanceof HTMLElement) || !panel.contains(focused)
    || !focused.matches('select, button.permission-remove')) return
  const row = focused.closest('.permission-row')
  if (!row) return
  const selector = focused.matches('select') ? 'select' : 'button.permission-remove'
  const rows = Array.from(panel.querySelectorAll('.permission-row'))
  const index = rows.indexOf(row)
  const candidates = [...rows.slice(index + 1), ...rows.slice(0, index).reverse()]
    .map(candidate => candidate.querySelector<HTMLElement>(selector))
  let superseded = false
  onCleanup(() => { superseded = true })
  await nextTick()
  if (superseded || panelRoot.value !== panel || !panel.isConnected) return
  if (document.activeElement !== document.body && document.activeElement !== focused) return
  if (focused.isConnected) {
    if (!focused.matches(':disabled')) focused.focus()
    return
  }
  const target = candidates.find(candidate => candidate?.isConnected
    && !candidate.matches(':disabled, [aria-disabled="true"]'))
    ?? panel.querySelector<HTMLElement>('.setting-copy h3')
  target?.focus()
}, { flush: 'pre' })

/**
 * The accessible name of a row's control, which names where the decision applies, since one website can have a row in
 * each workspace.
 */
function controlLabel(entry: SitePermissionEntry, kind: 'select' | 'forget'): string {
  const permission = permissionLabel(entry.permission)
  return t(kind === 'select' ? 'runtimeActions.permission.scopedAria' : 'runtimeActions.permission.scopedForgetAria', {
    permission,
    origin: entry.origin,
    scope: scopeLabel(entry)
  })
}

async function changeFileSaving(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  if (!(await setFileSaving(input.checked))) input.checked = fileSavingEnabled.value
}

/**
 * Saves a permission's default for every website. The selects are disabled while it saves, so Chromium moves the focus
 * to the document body; it goes back to the select once that is enabled again, unless the human moved on.
 */
async function changeDefault(permission: string, event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const focused = document.activeElement === input
  if (!(await setBlockedByDefault(permission, input.value === 'deny'))) input.value = defaultValue(permission)
  await nextTick()
  if (!focused || !input.isConnected || input.matches(':disabled') || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== input) return
  input.focus()
}

function defaultValue(permission: string): 'built-in' | 'deny' {
  return isBlockedByDefault(permission) ? 'deny' : 'built-in'
}

function resetAllDefaults(): void {
  if (!blockedByDefault.value.length || defaultsPending.value || clearing.value) return
  void resetDefaults()
}

async function changePermission(entry: SitePermissionEntry, event: Event): Promise<void> {
  const input = event.target as HTMLSelectElement
  const panel = panelRoot.value
  const focused = document.activeElement === input
  const decision = input.value as SitePermissionDecision
  if (!(await setDecision(entry, decision))) input.value = entry.decision
  // The select is disabled while its decision saves, so Chromium moves its focus to the document body. Give it back
  // once the select is enabled again, unless the human moved on or the row went away.
  await nextTick()
  if (!focused || !panel || panelRoot.value !== panel || !panel.isConnected || !input.isConnected
    || input.matches(':disabled') || !document.hasFocus()) return
  if (document.activeElement !== document.body && document.activeElement !== input) return
  input.focus()
}
</script>

<template>
  <div ref="panelRoot" class="settings-content permissions-settings">
    <UiTabs v-model="activeTab" :items="settingsTabs" :label="t('settings.permissions.tabs')" class="permission-settings-tabs">
      <template #header>
        <div class="setting-copy">
          <h3 tabindex="-1">{{ t('settings.permissions.heading') }}</h3>
          <p>{{ t('settings.permissions.description') }}</p>
        </div>
      </template>
      <template v-if="activeTab === 'defaults'">
        <p class="permission-defaults-description">{{ t('settings.permissions.defaultsDescription') }}</p>
        <section
          v-for="group in defaultGroups"
          :key="group.id"
          class="permission-site permission-defaults"
          :aria-labelledby="`permission-defaults-${group.id}`"
        >
          <h4 :id="`permission-defaults-${group.id}`">{{ group.heading }}</h4>
          <div v-for="permission in group.permissions" :key="permission" class="permission-default-row">
            <span class="permission-name"><strong>{{ permissionLabel(permission) }}</strong></span>
            <select
              :value="defaultValue(permission)"
              :disabled="clearing || defaultsPending"
              :aria-label="t('settings.permissions.defaultAria', { permission: permissionLabel(permission) })"
              @change="changeDefault(permission, $event)"
            >
              <option value="built-in">{{ group.builtIn }}</option>
              <option value="deny">{{ permission === SITE_SOUND_PERMISSION ? t('runtime.permissions.mute') : t('settings.permissions.block') }}</option>
            </select>
          </div>
        </section>
        <UiButton
          variant="ghost"
          class="permission-defaults-reset"
          type="button"
          :aria-disabled="!blockedByDefault.length || clearing || defaultsPending"
          @keydown="ignoreHeldEnter"
          @click="resetAllDefaults"
        >{{ t('settings.permissions.resetDefaults') }}</UiButton>
        <div class="settings-rows">
          <label class="settings-row" for="setting-website-file-saving">
            <span>
              <strong>{{ t('settings.permissions.fileSaving') }}</strong>
              <small>{{ t('settings.permissions.fileSavingDescription') }}</small>
            </span>
            <UiCheckbox bare appearance="switch" id="setting-website-file-saving" :checked="fileSavingEnabled"
              :disabled="fileSavingPending" aria-describedby="website-file-saving-warning" @change="changeFileSaving" />
          </label>
          <div class="settings-info" :class="{ 'security-warning': fileSavingEnabled }">
            <span class="info-dot" aria-hidden="true">
              <IconWarning v-if="fileSavingEnabled" />
              <IconInfo v-else />
            </span>
            <p id="website-file-saving-warning">{{ t('settings.permissions.fileSavingWarning') }}</p>
          </div>
        </div>
      </template>
      <template v-else>
        <label class="settings-search permission-search">
          <IconSearch aria-hidden="true" />
          <input v-model="search" type="search" :aria-label="t('settings.permissions.search')" :placeholder="t('settings.permissions.search')" maxlength="256" autocomplete="off" spellcheck="false" />
        </label>
        <p class="permission-search-summary" role="status">{{ t('settings.permissions.searchSummary', { visible: localNumber(visibleCount), total: localNumber(totalCount) }) }}</p>
        <div v-if="!groups.length" class="site-permissions-empty">
          <span class="empty-permission-icon" aria-hidden="true"><IconPrivacy /></span>
          <strong>{{ t('settings.permissions.emptyHeading') }}</strong>
          <p>{{ t('settings.permissions.emptyDescription') }}</p>
        </div>
        <p v-else-if="!filteredGroups.length" class="settings-search-empty">{{ t('settings.permissions.noMatches') }}</p>
        <div v-else class="permission-sites" :aria-busy="clearing">
          <section v-for="group in filteredGroups" :key="group.origin" class="permission-site">
            <h4>{{ group.origin }}</h4>
            <div
              v-for="permission in group.permissions"
              :key="permissionKey(permission)"
              class="permission-row"
            >
              <span class="permission-name">
                <strong>{{ permissionLabel(permission.permission) }}</strong>
                <small>{{ permission.permission }} · {{ scopeLabel(permission) }}</small>
              </span>
              <select
                :value="permission.decision"
                :disabled="clearing || isPending(permission)"
                :aria-label="controlLabel(permission, 'select')"
                @change="changePermission(permission, $event)"
              >
                <option value="allow">{{ t('settings.permissions.allow') }}</option>
                <option value="deny">{{ permission.permission === SITE_SOUND_PERMISSION ? t('runtime.permissions.mute') : t('settings.permissions.block') }}</option>
              </select>
              <UiIconButton variant="danger"
                class="permission-remove"
                type="button"
                :label="controlLabel(permission, 'forget')"
                :tooltip="t('settings.permissions.forget')"
                :aria-disabled="clearing || isPending(permission)"
                @keydown="ignoreHeldEnter"
                @click="remove(permission)"
              >
                <IconDelete aria-hidden="true" />
              </UiIconButton>
            </div>
          </section>
        </div>
        <output v-if="errorMessage" class="site-controls-error" role="alert">{{ errorMessage }}</output>
        <div class="settings-info">
          <span class="info-dot" aria-hidden="true"><IconInfo /></span>
          <p>{{ t('settings.permissions.help') }}</p>
        </div>
      </template>
    </UiTabs>
  </div>
</template>
