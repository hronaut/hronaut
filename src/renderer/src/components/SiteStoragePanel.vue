<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { onBeforeUnmount, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCookie from '~icons/material-symbols/cookie-rounded'
import IconDatabase from '~icons/material-symbols/database-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDifference from '~icons/material-symbols/difference-rounded'
import IconLock from '~icons/material-symbols/lock-rounded'
import IconOffline from '~icons/material-symbols/offline-bolt-rounded'
import IconPieChart from '~icons/material-symbols/pie-chart-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import { formatBytes as formatLocalizedBytes, formatNumber } from '../../../shared/format'
import type { BrowserTabState, PanelDock, SupportedLocale } from '../../../shared/types'
import { useSiteStorageController } from '../composables/useSiteStorageController'
import PanelDockPicker from './PanelDockPicker.vue'
import SiteStorageChangesView from './SiteStorageChangesView.vue'
import SiteStorageIndexedDbView from './SiteStorageIndexedDbView.vue'
import SiteStoragePwaView from './SiteStoragePwaView.vue'
import SiteStorageUsageView from './SiteStorageUsageView.vue'

const props = defineProps<{
  activeTab?: BrowserTabState
  locale: SupportedLocale
  copyText: (text: string) => Promise<boolean>
  keepsSeparatePanelOpen: () => boolean
}>()

const open = defineModel<boolean>('open', { required: true })
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  kind: siteStorageKind,
  result: siteStorageResult,
  state: siteStorageState,
  error: siteStorageError,
  search: siteStorageSearch,
  key: siteStorageKey,
  value: siteStorageValue,
  changesOpen: siteStorageChangesOpen,
  changesReport: siteStorageChangesReport,
  changesState: siteStorageChangesState,
  changesError: siteStorageChangesError,
  changesCopied: siteStorageChangesCopied,
  usageOpen: siteStorageUsageOpen,
  usageReport: siteStorageUsageReport,
  usageState: siteStorageUsageState,
  usageError: siteStorageUsageError,
  usageCopied: siteStorageUsageCopied,
  indexedDbOpen: siteStorageIndexedDbOpen,
  indexedDbReport: siteStorageIndexedDbReport,
  indexedDbState: siteStorageIndexedDbState,
  indexedDbError: siteStorageIndexedDbError,
  indexedDbDatabase: siteStorageIndexedDbDatabase,
  indexedDbStore: siteStorageIndexedDbStore,
  indexedDbOffset: siteStorageIndexedDbOffset,
  indexedDbSearch: siteStorageIndexedDbSearch,
  indexedDbCopied: siteStorageIndexedDbCopied,
  pwaOpen: siteStoragePwaOpen,
  pwaReport: siteStoragePwaReport,
  pwaState: siteStoragePwaState,
  pwaError: siteStoragePwaError,
  pwaCache: siteStoragePwaCache,
  pwaQuery: siteStoragePwaQuery,
  pwaOffset: siteStoragePwaOffset,
  pwaCopied: siteStoragePwaCopied,
  activeHostname,
  filteredItems: filteredSiteStorageItems,
  kindLabel: siteStorageKindLabel,
  filteredIndexedDbEntries: filteredSiteStorageIndexedDbEntries,
  reset,
  refresh,
  refreshActiveView: refreshActiveSiteStorageView,
  manageChanges: manageSiteStorageChanges,
  selectChanges: selectSiteStorageChanges,
  inspectChange: inspectStorageChange,
  selectUsage: selectSiteStorageUsage,
  copyUsage: copySiteStorageUsage,
  copyChanges: copySiteStorageChanges,
  selectIndexedDb: selectSiteStorageIndexedDb,
  selectIndexedDbDatabase: selectSiteStorageIndexedDbDatabase,
  selectIndexedDbStore: selectSiteStorageIndexedDbStore,
  moveIndexedDbPage: moveSiteStorageIndexedDbPage,
  copyIndexedDb: copySiteStorageIndexedDb,
  selectPwa: selectSiteStoragePwa,
  selectPwaCache: selectSiteStoragePwaCache,
  filterPwa: filterSiteStoragePwa,
  movePwaPage: moveSiteStoragePwaPage,
  copyPwa: copySiteStoragePwa,
  selectKind: selectSiteStorageKind,
  editItem: editSiteStorageItem,
  saveItem: saveSiteStorageItem,
  deleteItem: deleteSiteStorageItem,
  clearKind: clearSiteStorageKind,
  dispose
} = useSiteStorageController({
  activeTab: toRef(props, 'activeTab'),
  open,
  locale: toRef(props, 'locale'),
  browser: window.hronaut,
  translate: (message, parameters) => t(message, parameters ?? {}),
  copyText: props.copyText,
  confirm: (message) => window.confirm(message),
  keepsSeparatePanelOpen: props.keepsSeparatePanelOpen
})

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localBytes(value: number): string {
  return formatLocalizedBytes(props.locale, value)
}

defineExpose({ reset, refresh, refreshActiveSiteStorageView })
onBeforeUnmount(dispose)
</script>

<template>
  <section v-if="open" class="site-storage-panel" data-shell-docked-panel role="dialog" aria-modal="false" aria-labelledby="site-storage-title">
    <header>
      <div><span class="eyebrow">{{ t('siteStorage.kicker') }}</span><h2 id="site-storage-title">{{ t('siteStorage.heading', { host: activeHostname }) }}</h2></div>
      <div class="site-storage-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('panels.siteStorage') })" />
        <UiButton appearance="application" type="button" :disabled="siteStorageUsageOpen ? siteStorageUsageState === 'loading' : siteStoragePwaOpen ? siteStoragePwaState === 'loading' : siteStorageIndexedDbOpen ? siteStorageIndexedDbState === 'loading' : siteStorageChangesOpen ? siteStorageChangesState === 'loading' : siteStorageState === 'loading' || siteStorageState === 'saving'" @click="refreshActiveSiteStorageView"><IconRefresh aria-hidden="true" /> {{ t('siteStorage.refresh') }}</UiButton>
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('siteStorage.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <nav class="site-storage-kinds" :aria-label="t('siteStorage.typeAria')">
      <UiButton appearance="application" type="button" :class="{ active: siteStorageUsageOpen }" :aria-pressed="siteStorageUsageOpen" :disabled="siteStorageState === 'saving'" @click="selectSiteStorageUsage"><IconPieChart aria-hidden="true" /> {{ t('siteStorage.overview') }}</UiButton>
      <UiButton appearance="application" type="button" :class="{ active: !siteStorageUsageOpen && !siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen && siteStorageKind === 'local-storage' }" :aria-pressed="!siteStorageUsageOpen && !siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen && siteStorageKind === 'local-storage'" :disabled="siteStorageState === 'saving'" @click="selectSiteStorageKind('local-storage')"><IconDatabase aria-hidden="true" /> {{ t('siteStorage.local') }}</UiButton>
      <UiButton appearance="application" type="button" :class="{ active: !siteStorageUsageOpen && !siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen && siteStorageKind === 'session-storage' }" :aria-pressed="!siteStorageUsageOpen && !siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen && siteStorageKind === 'session-storage'" :disabled="siteStorageState === 'saving'" @click="selectSiteStorageKind('session-storage')"><IconDatabase aria-hidden="true" /> {{ t('siteStorage.session') }}</UiButton>
      <UiButton appearance="application" type="button" :class="{ active: !siteStorageUsageOpen && !siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen && siteStorageKind === 'cookies' }" :aria-pressed="!siteStorageUsageOpen && !siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen && siteStorageKind === 'cookies'" :disabled="siteStorageState === 'saving'" @click="selectSiteStorageKind('cookies')"><IconCookie aria-hidden="true" /> {{ t('siteStorage.cookies') }}</UiButton>
      <UiButton appearance="application" type="button" :class="{ active: siteStorageIndexedDbOpen }" :aria-pressed="siteStorageIndexedDbOpen" :disabled="siteStorageState === 'saving'" @click="selectSiteStorageIndexedDb"><IconDatabase aria-hidden="true" /> {{ t('runtime.storage.indexedDb') }}</UiButton>
      <UiButton appearance="application" type="button" :class="{ active: siteStoragePwaOpen }" :aria-pressed="siteStoragePwaOpen" :disabled="siteStorageState === 'saving'" @click="selectSiteStoragePwa"><IconOffline aria-hidden="true" /> {{ t('siteStorage.offline') }}</UiButton>
      <UiButton appearance="application" type="button" :class="{ active: siteStorageChangesOpen }" :aria-pressed="siteStorageChangesOpen" :disabled="siteStorageState === 'saving'" @click="selectSiteStorageChanges"><IconDifference aria-hidden="true" /> {{ t('siteStorage.changes') }}</UiButton>
    </nav>
    <SiteStorageUsageView
      v-if="siteStorageUsageOpen"
      :state="siteStorageUsageState"
      :report="siteStorageUsageReport"
      :error="siteStorageUsageError"
      :copied="siteStorageUsageCopied"
      :locale="locale"
      @copy="copySiteStorageUsage"
    />
    <template v-else-if="!siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen">
      <div class="site-storage-tools">
        <label class="site-storage-search"><IconSearch aria-hidden="true" /><input v-model="siteStorageSearch" type="search" :aria-label="t('siteStorage.filter')" :placeholder="t('siteStorage.filterPlaceholder')" autocomplete="off" /></label>
        <UiButton appearance="application" class="site-storage-clear" type="button" :disabled="!siteStorageResult?.itemCount || siteStorageState === 'saving'" @click="clearSiteStorageKind"><IconDelete aria-hidden="true" /> {{ t('siteStorage.clearKind', { kind: siteStorageKindLabel.toLocaleLowerCase(locale) }) }}</UiButton>
      </div>
      <form class="site-storage-editor" @submit.prevent="saveSiteStorageItem">
        <input v-model="siteStorageKey" type="text" :aria-label="t('siteStorage.key')" :disabled="siteStorageState === 'saving'" maxlength="512" :placeholder="t('siteStorage.keyPlaceholder')" autocomplete="off" spellcheck="false" />
        <textarea v-model="siteStorageValue" :aria-label="t('siteStorage.value')" :disabled="siteStorageState === 'saving'" maxlength="262144" rows="2" :placeholder="t('siteStorage.valuePlaceholder')" spellcheck="false" />
        <UiButton appearance="application" type="submit" :disabled="!siteStorageKey.trim() || siteStorageState === 'saving'">{{ siteStorageResult?.items.some((item) => item.key === siteStorageKey) ? t('siteStorage.update') : t('siteStorage.add') }}</UiButton>
      </form>
      <div class="site-storage-list" :aria-busy="siteStorageState === 'loading'">
        <div v-if="siteStorageState === 'loading'" class="site-storage-empty"><IconProgress class="state-spinner" aria-hidden="true" /><strong>{{ t('siteStorage.reading') }}</strong></div>
        <div v-else-if="!siteStorageResult?.itemCount" class="site-storage-empty"><IconDatabase aria-hidden="true" /><strong>{{ t('siteStorage.noKind', { kind: siteStorageKindLabel.toLocaleLowerCase(locale) }) }}</strong><span>{{ t('siteStorage.noKindDescription') }}</span></div>
        <div v-else-if="!filteredSiteStorageItems.length" class="site-storage-empty compact"><IconSearch aria-hidden="true" /><strong>{{ t('siteStorage.noMatches') }}</strong></div>
        <template v-else>
          <article v-for="(item, index) in filteredSiteStorageItems" :key="`${item.key}-${item.domain ?? ''}-${item.path ?? ''}-${index}`" class="site-storage-item" :class="{ protected: item.protected }">
            <UiButton appearance="application" class="site-storage-item-main" type="button" :disabled="item.protected || siteStorageState === 'saving'" :title="item.protected ? t('siteStorage.protectedTitle') : t('siteStorage.editTitle')" @click="editSiteStorageItem(item)">
                <strong>{{ item.key }}</strong>
                <code>{{ item.protected ? t('siteStorage.protectedValue') : (item.value || t('siteStorage.emptyValue')) }}</code>
                <small>{{ localBytes(item.valueBytes) }}<template v-if="item.domain"> · {{ item.domain }}{{ item.path }}</template><template v-if="item.valueTruncated"> {{ t('siteStorage.previewTruncated') }}</template></small>
            </UiButton>
            <UiButton appearance="application" class="site-storage-item-delete" type="button" :disabled="item.protected || siteStorageState === 'saving'" :aria-label="item.protected ? t('siteStorage.protectedAria', { key: item.key }) : t('siteStorage.deleteAria', { key: item.key })" :title="item.protected ? t('siteStorage.protectedCookie') : t('siteStorage.deleteEntry')" @click="deleteSiteStorageItem(item)"><IconLock v-if="item.protected" aria-hidden="true" /><IconDelete v-else aria-hidden="true" /></UiButton>
          </article>
        </template>
      </div>
      <footer>
        <span>{{ t('siteStorage.entries', { count: localNumber(siteStorageResult?.itemCount ?? 0) }, siteStorageResult?.itemCount ?? 0) }}</span>
        <span>{{ siteStorageKind === 'session-storage' ? t('siteStorage.thisTab') : t('siteStorage.sharedOrigin') }}</span>
      </footer>
    </template>
    <SiteStorageIndexedDbView
      v-else-if="siteStorageIndexedDbOpen"
      v-model:database="siteStorageIndexedDbDatabase"
      v-model:store="siteStorageIndexedDbStore"
      v-model:search="siteStorageIndexedDbSearch"
      :state="siteStorageIndexedDbState"
      :report="siteStorageIndexedDbReport"
      :error="siteStorageIndexedDbError"
      :copied="siteStorageIndexedDbCopied"
      :entries="filteredSiteStorageIndexedDbEntries"
      :offset="siteStorageIndexedDbOffset"
      :locale="locale"
      @database-change="selectSiteStorageIndexedDbDatabase"
      @store-change="selectSiteStorageIndexedDbStore"
      @copy="copySiteStorageIndexedDb"
      @move="moveSiteStorageIndexedDbPage"
    />
    <SiteStoragePwaView
      v-else-if="siteStoragePwaOpen"
      v-model:cache="siteStoragePwaCache"
      v-model:query="siteStoragePwaQuery"
      :state="siteStoragePwaState"
      :report="siteStoragePwaReport"
      :error="siteStoragePwaError"
      :copied="siteStoragePwaCopied"
      :offset="siteStoragePwaOffset"
      :locale="locale"
      @copy="copySiteStoragePwa"
      @cache-change="selectSiteStoragePwaCache"
      @filter="filterSiteStoragePwa"
      @move="moveSiteStoragePwaPage"
    />
    <SiteStorageChangesView
      v-else
      :state="siteStorageChangesState"
      :report="siteStorageChangesReport"
      :error="siteStorageChangesError"
      :copied="siteStorageChangesCopied"
      :locale="locale"
      @manage="manageSiteStorageChanges"
      @inspect="inspectStorageChange"
      @copy="copySiteStorageChanges"
    />
    <p v-if="siteStorageError && !siteStorageUsageOpen && !siteStorageChangesOpen && !siteStorageIndexedDbOpen && !siteStoragePwaOpen" class="site-storage-error" role="alert">{{ siteStorageError }}</p>
  </section>
</template>
