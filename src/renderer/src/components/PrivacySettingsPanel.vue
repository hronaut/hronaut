<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCleaning from '~icons/material-symbols/cleaning-services-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconLanguage from '~icons/material-symbols/language-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconSearch from '~icons/material-symbols/search-rounded'
import type { PrivacySettingsController } from '../composables/usePrivacySettingsController'

const props = defineProps<{
  controller: PrivacySettingsController
  formatBytes: (bytes: number) => string
  formatNumber: (value: number) => string
}>()

const { t } = useI18n({ useScope: 'global' })
const {
  summary,
  clearOptions,
  summaryState,
  summaryMessage,
  websites,
  search,
  websiteState,
  clearingOrigin,
  websiteMessage,
  selectedCount,
  clearing,
  canClear,
  filteredWebsites,
  refreshWebsites,
  clearSelected,
  clearWebsite,
  websiteMeta
} = props.controller
</script>

<template>
  <div class="settings-content privacy-settings">
    <div class="setting-copy">
      <h3>{{ t('settings.privacy.heading') }}</h3>
      <p>{{ t('settings.privacy.description') }}</p>
    </div>
    <fieldset class="privacy-category-options" :disabled="clearing">
      <legend>{{ t('settings.privacy.whatToClear') }}</legend>
      <label for="clear-browsing-history">
        <input id="clear-browsing-history" v-model="clearOptions.history" type="checkbox" />
        <span><strong>{{ t('settings.privacy.history') }}</strong><small>{{ t('settings.privacy.localVisits') }}</small></span>
      </label>
      <label for="clear-cookies-site-data">
        <input id="clear-cookies-site-data" v-model="clearOptions.cookiesAndSiteData" type="checkbox" />
        <span><strong>{{ t('settings.privacy.cookies') }}</strong><small>{{ t('settings.privacy.signOut') }}</small></span>
      </label>
      <label for="clear-browser-cache">
        <input id="clear-browser-cache" v-model="clearOptions.cache" type="checkbox" />
        <span><strong>{{ t('settings.privacy.cache') }}</strong><small>{{ t('settings.privacy.slower') }}</small></span>
      </label>
    </fieldset>
    <div class="privacy-data-actions">
      <UiButton native class="clear-data-button" type="button" :disabled="!canClear" @click="clearSelected">
        {{ summaryState === 'clearing' ? t('settings.privacy.clearingAll') : t('settings.privacy.clearAll', { count: formatNumber(selectedCount) }) }}
      </UiButton>
      <output class="privacy-data-status" :class="summaryState" aria-live="polite">{{ summaryMessage || (summary ? t('settings.privacy.totalsDetail', { history: t('settings.privacy.totals', { history: formatNumber(summary.historyEntries) }, summary.historyEntries), cookies: t(summary.cookieCount === 1 ? 'shell.siteControls.cookie' : 'shell.siteControls.cookies', { count: formatNumber(summary.cookieCount) }), cache: formatBytes(summary.cacheBytes) }) : t('settings.privacy.loadingTotals')) }}</output>
    </div>
    <div class="privacy-websites-heading">
      <div>
        <h4>{{ t('settings.privacy.websites') }}</h4>
        <p>{{ t('settings.privacy.websitesDescription') }}</p>
      </div>
      <UiButton native class="secondary-button janitor-refresh" type="button" :disabled="websiteState === 'loading' || clearing" @click="refreshWebsites">
        <IconRefresh aria-hidden="true" />
        {{ t('settings.privacy.refresh') }}
      </UiButton>
    </div>
    <div class="janitor-search-field">
      <IconSearch aria-hidden="true" />
      <input v-model="search" type="search" :aria-label="t('settings.privacy.search')" autocomplete="off" spellcheck="false" :placeholder="t('settings.privacy.search')" />
      <span>{{ t('settings.privacy.range', { shown: formatNumber(filteredWebsites.length), total: formatNumber(websites.length) }) }}</span>
    </div>
    <div class="janitor-list" :aria-busy="websiteState === 'loading'">
      <div v-if="websiteState === 'loading' && !websites.length" class="site-permissions-empty janitor-empty">
        <IconProgress class="state-spinner" aria-hidden="true" />
        <strong>{{ t('settings.privacy.finding') }}</strong>
        <p>{{ t('settings.privacy.checking') }}</p>
      </div>
      <div v-else-if="!websites.length" class="site-permissions-empty janitor-empty">
        <IconCleaning aria-hidden="true" />
        <strong>{{ t('settings.privacy.empty') }}</strong>
        <p>{{ t('settings.privacy.emptyDescription') }}</p>
      </div>
      <div v-else-if="!filteredWebsites.length" class="site-permissions-empty janitor-empty">
        <IconSearch aria-hidden="true" />
        <strong>{{ t('settings.privacy.noMatches') }}</strong>
        <p>{{ t('settings.privacy.noMatchesDescription') }}</p>
      </div>
      <article v-for="site in filteredWebsites" v-else :key="site.origin" class="janitor-site">
        <span class="janitor-site-icon" aria-hidden="true"><IconLanguage /></span>
        <span class="janitor-site-copy">
          <strong :title="site.title">{{ site.hostname }}</strong>
          <small :title="site.origin">{{ site.origin }}</small>
          <span v-if="websiteMeta(site).length" class="janitor-site-meta">
            <span v-for="item in websiteMeta(site)" :key="item">{{ item }}</span>
          </span>
          <span v-else class="janitor-site-meta"><span>{{ t('settings.privacy.known') }}</span></span>
        </span>
        <UiButton native
          class="janitor-clear-button"
          type="button"
          :aria-label="t('settings.privacy.clearSiteAria', { origin: site.origin })"
          :disabled="selectedCount === 0 || clearing"
          @click="clearWebsite(site)"
        >
          <IconProgress v-if="clearingOrigin === site.origin" class="state-spinner" aria-hidden="true" />
          <IconDelete v-else aria-hidden="true" />
          {{ clearingOrigin === site.origin ? t('settings.privacy.clearing') : t('settings.privacy.clear') }}
        </UiButton>
      </article>
    </div>
    <output class="privacy-data-status janitor-status" :class="websiteState" aria-live="polite">{{ websiteMessage }}</output>
    <div class="settings-info">
      <span class="info-dot" aria-hidden="true"><IconInfo /></span>
      <p>{{ t('settings.privacy.exclusions', { bookmarks: summary?.bookmarkCount === undefined ? '…' : formatNumber(summary.bookmarkCount), passwords: summary?.savedPasswordCount === undefined ? '…' : formatNumber(summary.savedPasswordCount), permissions: summary?.permissionDecisionCount === undefined ? '…' : formatNumber(summary.permissionDecisionCount) }) }}</p>
    </div>
  </div>
</template>
