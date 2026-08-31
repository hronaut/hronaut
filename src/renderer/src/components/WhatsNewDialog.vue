<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconHistory from '~icons/material-symbols/history-rounded'
import IconLaunch from '~icons/material-symbols/open-in-new-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import type { ReleaseHistoryController } from '../composables/useReleaseHistoryController.js'
import { useModalDialogFocus } from '../composables/useModalDialogFocus.js'
import { formatReleaseNotes } from '../release-notes.js'

const props = defineProps<{
  controller: ReleaseHistoryController
  openUrl: (url: string) => Promise<void>
  reportLayout: () => void
}>()

const { t, locale } = useI18n({ useScope: 'global' })
const panel = ref<HTMLElement | null>(null)
const { open, releases, state, error, operation, hasMore, busy, close, refresh, loadMore } = props.controller
const formattedReleases = computed(() => releases.value.map((release) => ({
  ...release,
  formattedNotes: release.notes ? formatReleaseNotes(release.notes) : ''
})))

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'long' }).format(new Date(value))
}

function openExternal(url: string): void {
  void props.openUrl(url)
}

function openReleaseNoteLink(event: MouseEvent): void {
  const target = event.target
  if (!(target instanceof Element)) return
  const link = target.closest<HTMLAnchorElement>('a[href]')
  if (!link) return
  event.preventDefault()
  openExternal(link.href)
}

useModalDialogFocus({ open, panel, afterLayout: props.reportLayout })
</script>

<template>
  <div v-if="open" class="settings-overlay whats-new-overlay" @click.self="close">
    <section
      ref="panel"
      class="whats-new-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
      :aria-busy="busy"
      tabindex="-1"
    >
      <header class="whats-new-header">
        <div>
          <span class="eyebrow">{{ t('updates.history.kicker') }}</span>
          <h2 id="whats-new-title">{{ t('updates.history.title') }}</h2>
        </div>
        <div class="whats-new-header-actions">
          <button type="button" :disabled="busy" :title="t('updates.history.refresh')" :aria-label="t('updates.history.refresh')" @click="refresh"><IconRefresh aria-hidden="true" /></button>
          <button class="panel-close" type="button" :aria-label="t('updates.history.close')" @click="close"><IconClose aria-hidden="true" /></button>
        </div>
      </header>

      <div class="whats-new-content">
        <div v-if="state === 'loading' && releases.length === 0" class="whats-new-state" role="status">
          <IconProgress class="state-spinner" aria-hidden="true" />
          <strong>{{ t('updates.history.loading') }}</strong>
          <span>{{ t('updates.history.loadingDescription') }}</span>
        </div>
        <div v-else-if="state === 'error' && releases.length === 0" class="whats-new-state error" role="alert">
          <IconHistory aria-hidden="true" />
          <strong>{{ t('updates.history.unavailable') }}</strong>
          <span>{{ error }}</span>
          <button class="primary-button" type="button" :disabled="busy" @click="refresh">{{ t('common.tryAgain') }}</button>
        </div>
        <div v-else-if="state === 'ready' && releases.length === 0" class="whats-new-state">
          <IconHistory aria-hidden="true" />
          <strong>{{ t('updates.history.empty') }}</strong>
          <span>{{ t('updates.history.emptyDescription') }}</span>
        </div>
        <div v-else class="whats-new-list">
          <article v-for="release in formattedReleases" :key="release.url" class="whats-new-release">
            <header>
              <div>
                <time :datetime="release.publishedAt">{{ formatDate(release.publishedAt) }}</time>
                <h3>{{ release.title }}</h3>
              </div>
              <button type="button" :aria-label="t('updates.history.openRelease', { version: release.version })" @click="openExternal(release.url)">
                <code>v{{ release.version }}</code><IconLaunch aria-hidden="true" />
              </button>
            </header>
            <div
              v-if="release.formattedNotes"
              class="release-notes whats-new-notes"
              @click="openReleaseNoteLink"
              v-html="release.formattedNotes"
            />
            <p v-else class="whats-new-no-notes">{{ t('updates.history.noNotes') }}</p>
          </article>
        </div>
      </div>

      <footer class="whats-new-footer">
        <span v-if="error && releases.length > 0" role="alert">{{ error }}</span>
        <span v-else>{{ t('updates.history.source') }}</span>
        <button v-if="hasMore && releases.length > 0" class="secondary-button" type="button" :disabled="busy" @click="loadMore">
          <IconProgress v-if="operation === 'more'" class="state-spinner" aria-hidden="true" />
          {{ operation === 'more' ? t('updates.history.loadingMore') : t('updates.history.loadMore') }}
        </button>
        <button v-else class="secondary-button" type="button" @click="openExternal('https://github.com/hronaut/hronaut/releases')">
          {{ t('updates.history.openAll') }}<IconLaunch aria-hidden="true" />
        </button>
      </footer>
    </section>
  </div>
</template>
