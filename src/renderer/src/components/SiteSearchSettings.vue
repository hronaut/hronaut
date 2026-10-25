<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import IconAdd from '~icons/material-symbols/add-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconEdit from '~icons/material-symbols/edit-outline-rounded'
import UiButton from '../ui/UiButton.vue'
import UiField from '../ui/UiField.vue'
import UiIconButton from '../ui/UiIconButton.vue'
import UiInput from '../ui/UiInput.vue'
import { ignoreHeldEnter } from '../held-enter.js'
import { isImeCompositionEvent } from '../keyboard-composition.js'
import {
  SITE_SEARCH_KEYWORD_MAX_LENGTH,
  SITE_SEARCH_LIMIT,
  SITE_SEARCH_NAME_MAX_LENGTH,
  SITE_SEARCH_URL_MAX_LENGTH,
  siteSearchProblems,
  type SiteSearch,
  type SiteSearchProblem
} from '../../../shared/site-search.js'
import type { SearchSettingsController } from '../composables/useSearchSettingsController.js'

/**
 * Settings' Site search list, as in Chrome's Settings > Search engine: each shortcut, typed in the address bar before
 * Tab or a space, searches its site (see address-keyword-search.ts). One form below the list adds a site search or
 * edits one. The form names what keeps it from saving once Save was pressed, by the rules main checks too.
 */
const props = defineProps<{
  controller: SearchSettingsController
}>()

const { t } = useI18n({ useScope: 'global' })
const { settings, siteSearchBusy, saveSiteSearch, removeSiteSearch } = props.controller
const ids = useId()
const headingId = `site-search-heading-${ids}`
const formHeadingId = `site-search-form-heading-${ids}`

const heading = ref<HTMLElement | null>(null)
const form = ref<HTMLFormElement | null>(null)
// The site search the form edits, null while it adds one, and undefined while there is no form.
const editing = ref<string | null | undefined>(undefined)
const name = ref('')
const keyword = ref('')
const url = ref('')
// Whether Save was pressed, after which the form names what is wrong as it is typed.
const attempted = ref(false)
// Each form opened or closed, so that a save that ends after the form changed leaves the newer one as it is.
let formGeneration = 0

const siteSearches = computed(() => settings.value.siteSearches)
const full = computed(() => siteSearches.value.length >= SITE_SEARCH_LIMIT)
const problems = computed(() => siteSearchProblems(
  { name: name.value, keyword: keyword.value, url: url.value },
  siteSearches.value.filter((entry) => entry.id !== editing.value)
))

function problemText(problem: SiteSearchProblem | undefined): string | undefined {
  if (!attempted.value || !problem) return undefined
  if (problem === 'nameTooLong' || problem === 'keywordTooLong' || problem === 'urlTooLong') return t('settings.search.site.tooLong')
  return t(`settings.search.site.${problem}`)
}

async function openForm(entry: SiteSearch | null): Promise<void> {
  if (siteSearchBusy.value || (entry === null && full.value)) return
  formGeneration += 1
  editing.value = entry?.id ?? null
  name.value = entry?.name ?? ''
  keyword.value = entry?.keyword ?? ''
  url.value = entry?.url ?? ''
  attempted.value = false
  await nextTick()
  form.value?.querySelector<HTMLInputElement>('input')?.focus()
}

// The list's heading takes the keyboard after the form closes or a row goes, never a button that a held Enter would
// press next.
async function focusHeading(): Promise<void> {
  await nextTick()
  // The keyboard stays where it went meanwhile, if that is still there.
  const active = document.activeElement
  if (active && active !== document.body && active.isConnected) return
  heading.value?.focus()
}

function closeForm(): Promise<void> {
  formGeneration += 1
  editing.value = undefined
  attempted.value = false
  return focusHeading()
}

async function save(): Promise<void> {
  const id = editing.value
  if (id === undefined || siteSearchBusy.value) return
  attempted.value = true
  if (Object.keys(problems.value).length) {
    await nextTick()
    form.value?.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus()
    return
  }
  const generation = formGeneration
  const saved = await saveSiteSearch(id, { name: name.value, keyword: keyword.value, url: url.value })
  if (saved && generation === formGeneration) await closeForm()
}

async function remove(entry: SiteSearch): Promise<void> {
  if (!await removeSiteSearch(entry.id)) return
  if (editing.value === entry.id) {
    formGeneration += 1
    editing.value = undefined
  }
  await focusHeading()
}

function formKeydown(event: KeyboardEvent): void {
  if (isImeCompositionEvent(event)) return
  // An Enter still held from Add or Edit does not save the form it opened.
  if (event.key === 'Enter' && event.repeat) {
    event.preventDefault()
    return
  }
  if (event.key !== 'Escape') return
  // Escape closes the form, and not Settings.
  event.preventDefault()
  if (!event.repeat) void closeForm()
}
</script>

<template>
  <section class="site-search-settings" :aria-labelledby="headingId">
    <div class="site-search-header">
      <div class="setting-copy">
        <h4 :id="headingId" ref="heading" tabindex="-1">{{ t('settings.search.site.heading') }}</h4>
        <p>{{ t('settings.search.site.description') }}</p>
      </div>
      <UiButton
        v-if="editing === undefined"
        class="site-search-add"
        :aria-disabled="siteSearchBusy || full || undefined"
        data-testid="site-search-add"
        @keydown="ignoreHeldEnter"
        @click="openForm(null)"
      >
        <IconAdd aria-hidden="true" />
        {{ t('settings.search.site.add') }}
      </UiButton>
    </div>
    <p v-if="full && editing === undefined" class="site-search-note">{{ t('settings.search.site.full') }}</p>
    <ul v-if="siteSearches.length" class="site-search-list" :aria-labelledby="headingId">
      <li v-for="entry in siteSearches" :key="entry.id" class="site-search-row" :data-site-search="entry.keyword">
        <span class="site-search-copy">
          <strong>{{ entry.name }}</strong>
          <code>{{ entry.keyword }}</code>
          <small>{{ entry.url }}</small>
        </span>
        <UiIconButton
          :label="t('settings.search.site.editAria', { name: entry.name })"
          :tooltip="t('settings.search.site.edit')"
          :aria-disabled="siteSearchBusy || undefined"
          @keydown="ignoreHeldEnter"
          @click="openForm(entry)"
        >
          <IconEdit aria-hidden="true" />
        </UiIconButton>
        <UiIconButton
          variant="danger"
          :label="t('settings.search.site.removeAria', { name: entry.name })"
          :tooltip="t('settings.search.site.remove')"
          :aria-disabled="siteSearchBusy || undefined"
          @keydown="ignoreHeldEnter"
          @click="remove(entry)"
        >
          <IconDelete aria-hidden="true" />
        </UiIconButton>
      </li>
    </ul>
    <p v-else-if="editing === undefined" class="site-search-empty">{{ t('settings.search.site.empty') }}</p>
    <form
      v-if="editing !== undefined"
      ref="form"
      class="site-search-form"
      :aria-labelledby="formHeadingId"
      novalidate
      @submit.prevent="save"
      @keydown="formKeydown"
    >
      <h5 :id="formHeadingId">{{ editing === null ? t('settings.search.site.add') : t('settings.search.site.editHeading') }}</h5>
      <UiField :label="t('settings.search.site.name')" :error="problemText(problems.name)">
        <UiInput v-model="name" :maxlength="SITE_SEARCH_NAME_MAX_LENGTH" autocomplete="off" spellcheck="false" data-testid="site-search-name" />
      </UiField>
      <UiField :label="t('settings.search.site.keyword')" :error="problemText(problems.keyword)">
        <UiInput v-model="keyword" :maxlength="SITE_SEARCH_KEYWORD_MAX_LENGTH" autocomplete="off" autocapitalize="off" spellcheck="false" data-testid="site-search-keyword" />
      </UiField>
      <UiField :label="t('settings.search.site.url')" :error="problemText(problems.url)">
        <UiInput
          v-model="url"
          type="url"
          :maxlength="SITE_SEARCH_URL_MAX_LENGTH"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-testid="site-search-url"
        />
      </UiField>
      <div class="site-search-actions">
        <UiButton variant="primary" type="submit" :aria-disabled="siteSearchBusy || undefined">{{ t('settings.search.site.save') }}</UiButton>
        <UiButton type="button" @click="closeForm">{{ t('settings.search.site.cancel') }}</UiButton>
      </div>
    </form>
  </section>
</template>
