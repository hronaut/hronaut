<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import UiButton from '../../../ui/UiButton.vue'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'
import IconClose from '~icons/material-symbols/close-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import { formatNumber, formatDateTime } from '../../../../../shared/format.js'
import type { BrowserPageMetadataReport, PanelDock, SupportedLocale } from '../../../../../shared/types.js'
import type { PageMetadataController } from './usePageMetadata.js'

const props = defineProps<{ controller: PageMetadataController; locale: SupportedLocale }>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const { pageMetadataPanelOpen: open, pageMetadataReport: report, pageMetadataState: state,
  pageMetadataError: error, runPageMetadata: inspect } = props.controller
const number = (value: number): string => formatNumber(props.locale, value)
const issueKeys = {
  'missing-title': 'missingTitle', 'multiple-titles': 'multipleTitles',
  'missing-description': 'missingDescription', 'multiple-descriptions': 'multipleDescriptions',
  'missing-canonical': 'missingCanonical', 'multiple-canonicals': 'multipleCanonicals',
  'missing-language': 'missingLanguage', 'missing-viewport': 'missingViewport',
  'robots-noindex': 'robotsNoindex', 'missing-h1': 'missingH1', 'multiple-h1': 'multipleH1',
  'incomplete-open-graph': 'incompleteOpenGraph', 'missing-og-image-alt': 'missingOgImageAlt',
  'missing-twitter-card': 'missingTwitterCard', 'invalid-json-ld': 'invalidJsonLd'
} as const
type Issue = BrowserPageMetadataReport['issues'][number]
function issueLabel(issue: Issue): string {
  const key = issueKeys[issue.code as keyof typeof issueKeys]
  return key ? t(`pageMetadata.issues.${key}.label`) : issue.code.replaceAll('-', ' ')
}
function issueMessage(issue: Issue): string {
  const key = issueKeys[issue.code as keyof typeof issueKeys]
  if (!key) return issue.message
  if (key === 'incompleteOpenGraph') return t('pageMetadata.issues.incompleteOpenGraph.message', { field: issue.message.match(/missing ([^.]+)\./)?.[1] ?? 'metadata' })
  if (key === 'invalidJsonLd') {
    const count = report.value?.structuredData.invalidBlockCount ?? 0
    return t('pageMetadata.issues.invalidJsonLd.message', { count }, count)
  }
  return t(`pageMetadata.issues.${key}.message`)
}
</script>

<template>
  <section v-if="open" class="accessibility-panel page-metadata-panel" data-shell-docked-panel
    role="dialog" aria-modal="false" aria-labelledby="page-metadata-panel-title" :aria-busy="state === 'loading'">
    <header>
      <div><span class="eyebrow">{{ t('pageMetadata.kicker') }}</span><h2 id="page-metadata-panel-title">{{ t('pageMetadata.heading') }}</h2></div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('pageMetadata.heading') })" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('pageMetadata.close')" @click="open = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="state === 'loading'" class="accessibility-audit-loading" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" /><strong>{{ t('pageMetadata.loading') }}</strong><span>{{ t('pageMetadata.privacy') }}</span>
    </div>
    <div v-else-if="state === 'error'" class="accessibility-audit-error" role="alert">
      <IconError aria-hidden="true" /><strong>{{ t('pageMetadata.failed') }}</strong><span>{{ error }}</span>
      <UiButton appearance="application" type="button" @click="inspect">{{ t('pageMetadata.tryAgain') }}</UiButton>
    </div>
    <template v-else-if="report">
      <div class="page-metadata-summary">
        <article><span>{{ t('pageMetadata.actionableFindings') }}</span><strong>{{ number(report.issues.filter(issue => issue.severity !== 'info').length) }}</strong></article>
        <article><span>{{ t('pageMetadata.h1Headings') }}</span><strong>{{ number(report.document.headingCounts.h1) }}</strong></article>
        <article><span>{{ t('pageMetadata.openGraphFields') }}</span><strong>{{ number(report.openGraph.propertyCount) }}</strong></article>
        <article :class="{ warning: report.structuredData.invalidBlockCount }"><span>{{ t('pageMetadata.structuredTypes') }}</span><strong>{{ number(report.structuredData.types.length) }}</strong></article>
      </div>
      <div class="page-metadata-details">
        <section v-if="report.issues.length">
          <h3>{{ t('pageMetadata.findings') }}</h3>
          <div class="page-metadata-issues" role="list">
            <article v-for="issue in report.issues" :key="`${issue.code}-${issue.message}`" :class="issue.severity" role="listitem">
              <IconError v-if="issue.severity === 'error'" aria-hidden="true" /><IconWarning v-else-if="issue.severity === 'warning'" aria-hidden="true" /><IconInfo v-else aria-hidden="true" />
              <div><strong>{{ issueLabel(issue) }}</strong><span>{{ issueMessage(issue) }}</span></div>
            </article>
          </div>
        </section>
        <section>
          <h3>{{ t('pageMetadata.searchInputs') }}</h3>
          <article class="search-preview" :aria-label="t('pageMetadata.preview')">
            <small>{{ report.document.canonicalUrls[0] || report.url }}</small><strong>{{ report.title || t('pageMetadata.untitled') }}</strong><p>{{ report.document.description || t('pageMetadata.noDescription') }}</p>
          </article>
          <dl class="page-metadata-grid">
            <div class="wide"><dt>{{ t('pageMetadata.canonical') }}</dt><dd>{{ report.document.canonicalUrls[0] || t('pageMetadata.notDeclared') }}</dd></div>
            <div v-for="field in (['language', 'charset', 'robots', 'viewport', 'themeColor'] as const)" :key="field">
              <dt>{{ t(`pageMetadata.${field}`) }}</dt><dd>{{ report.document[field] || t(field === 'robots' ? 'pageMetadata.defaultIndexing' : field === 'charset' ? 'pageMetadata.unavailable' : 'pageMetadata.notDeclared') }}</dd>
            </div>
            <div><dt>{{ t('pageMetadata.manifest') }}</dt><dd>{{ report.document.manifestUrl || t('pageMetadata.notLinked') }}</dd></div>
            <div class="wide"><dt>{{ t('pageMetadata.headingCounts') }}</dt><dd>{{ t('pageMetadata.headingCountsValue', { h1: number(report.document.headingCounts.h1), h2: number(report.document.headingCounts.h2), h3: number(report.document.headingCounts.h3), h4to6: number(report.document.headingCounts.h4 + report.document.headingCounts.h5 + report.document.headingCounts.h6) }) }}</dd></div>
          </dl>
        </section>
        <section>
          <h3>{{ t('pageMetadata.socialCards') }}</h3>
          <div class="social-metadata-cards">
            <article>
              <header><strong>{{ t('pageMetadata.openGraph') }}</strong><small>{{ t('pageMetadata.propertyCount', { count: number(report.openGraph.propertyCount) }, report.openGraph.propertyCount) }}</small></header>
              <dl>
                <div v-for="field in (['title', 'type', 'url', 'description'] as const)" :key="field"><dt>{{ t(`pageMetadata.${field}`) }}</dt><dd>{{ report.openGraph[field] || t('pageMetadata.notDeclared') }}</dd></div>
                <div><dt>{{ t('pageMetadata.image') }}</dt><dd>{{ report.openGraph.images[0]?.url || t('pageMetadata.notDeclared') }}</dd></div>
                <div><dt>{{ t('pageMetadata.imageAlt') }}</dt><dd>{{ report.openGraph.images[0]?.alt || t('pageMetadata.notDeclared') }}</dd></div>
              </dl>
            </article>
            <article>
              <header><strong>{{ t('pageMetadata.twitterCard') }}</strong><small>{{ t('pageMetadata.propertyCount', { count: number(report.twitter.propertyCount) }, report.twitter.propertyCount) }}</small></header>
              <dl>
                <div><dt>{{ t('pageMetadata.card') }}</dt><dd>{{ report.twitter.card || t('pageMetadata.notDeclared') }}</dd></div>
                <div><dt>{{ t('pageMetadata.title') }}</dt><dd>{{ report.twitter.title || t('pageMetadata.fallbackTitle') }}</dd></div>
                <div><dt>{{ t('pageMetadata.description') }}</dt><dd>{{ report.twitter.description || t('pageMetadata.fallbackDescription') }}</dd></div>
                <div><dt>{{ t('pageMetadata.image') }}</dt><dd>{{ report.twitter.images[0]?.url || t('pageMetadata.notDeclared') }}</dd></div>
              </dl>
            </article>
          </div>
        </section>
        <section>
          <h3>{{ t('pageMetadata.structuredData') }}</h3>
          <div v-if="report.structuredData.types.length" class="metadata-type-list" :aria-label="t('pageMetadata.structuredTypes')"><span v-for="type in report.structuredData.types" :key="type">{{ type }}</span></div>
          <p v-else>{{ t('pageMetadata.noStructuredTypes') }}</p>
          <div v-if="report.structuredData.blocks.some(block => !block.valid)" class="metadata-json-errors">
            <div v-for="block in report.structuredData.blocks.filter(item => !item.valid)" :key="block.index"><strong>{{ t('pageMetadata.block', { number: number(block.index + 1) }) }}</strong><span>{{ t('pageMetadata.issues.invalidJsonLd.label') }}</span></div>
          </div>
        </section>
        <section v-if="report.alternateLinks.length || report.icons.length">
          <h3>{{ t('pageMetadata.linkedMetadata') }}</h3>
          <details v-if="report.alternateLinks.length"><summary>{{ t('pageMetadata.alternateCount', { count: number(report.alternateLinks.length) }, report.alternateLinks.length) }}</summary><ul><li v-for="alternate in report.alternateLinks" :key="`${alternate.language}-${alternate.url}`"><strong>{{ alternate.language }}</strong><code>{{ alternate.url }}</code></li></ul></details>
          <details v-if="report.icons.length"><summary>{{ t('pageMetadata.iconCount', { count: number(report.icons.length) }, report.icons.length) }}</summary><ul><li v-for="icon in report.icons" :key="`${icon.rel}-${icon.url}`"><strong>{{ icon.sizes || icon.type || icon.rel }}</strong><code>{{ icon.url }}</code></li></ul></details>
        </section>
        <details><summary>{{ t('pageMetadata.scope') }}</summary><ul><li>{{ t('pageMetadata.caveats.rendered') }}</li><li>{{ t('pageMetadata.caveats.outcomes') }}</li><li>{{ t('pageMetadata.caveats.allowlist') }}</li></ul></details>
      </div>
      <footer>
        <span>{{ t('pageMetadata.renderedDom') }} · {{ formatDateTime(locale, report.capturedAt) }}</span>
        <UiButton appearance="application" type="button" @click="inspect"><IconRefresh aria-hidden="true" /> {{ t('pageMetadata.inspectAgain') }}</UiButton>
      </footer>
    </template>
  </section>
</template>
