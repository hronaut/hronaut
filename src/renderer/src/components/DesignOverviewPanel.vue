<script setup lang="ts">
import UiButton from "../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import { formatNumber } from '../../../shared/format'
import type { PanelDock, SupportedLocale } from '../../../shared/types'
import type { DiagnosticsController } from '../composables/useDiagnosticsController'
import PanelDockPicker from './PanelDockPicker.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  designOverviewPanelOpen,
  designOverviewReport,
  designOverviewState,
  designOverviewError,
  runDesignOverview
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function debugTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat(props.locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  }).format(date)
}
</script>

<template>
  <section
    v-if="designOverviewPanelOpen"
    class="accessibility-panel design-overview-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="design-overview-panel-title"
    :aria-busy="designOverviewState === 'loading'"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('designOverview.kicker') }}</span>
        <h2 id="design-overview-panel-title">{{ t('designOverview.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('designOverview.heading') })" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('designOverview.close')" @click="designOverviewPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="designOverviewState === 'loading'" class="accessibility-audit-loading" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" />
      <strong>{{ t('designOverview.loading') }}</strong>
      <span>{{ t('designOverview.privacy') }}</span>
    </div>
    <div v-else-if="designOverviewState === 'error'" class="accessibility-audit-error" role="alert">
      <IconError aria-hidden="true" />
      <strong>{{ t('designOverview.failed') }}</strong>
      <span>{{ designOverviewError }}</span>
      <UiButton appearance="application" type="button" @click="runDesignOverview">{{ t('designOverview.tryAgain') }}</UiButton>
    </div>
    <template v-else-if="designOverviewReport">
      <div class="design-overview-summary">
        <article><span>{{ t('designOverview.visibleElements') }}</span><strong>{{ localNumber(designOverviewReport.summary.visibleElements) }}</strong></article>
        <article><span>{{ t('designOverview.colors') }}</span><strong>{{ localNumber(designOverviewReport.summary.textColorCount + designOverviewReport.summary.backgroundColorCount + designOverviewReport.summary.borderColorCount) }}</strong></article>
        <article><span>{{ t('designOverview.fontCombinations') }}</span><strong>{{ localNumber(designOverviewReport.summary.fontCombinationCount) }}</strong></article>
        <article :class="{ warning: designOverviewReport.summary.contrastIssueCount }"><span>{{ t('designOverview.contrastIssues') }}</span><strong>{{ localNumber(designOverviewReport.summary.contrastIssueCount) }}</strong></article>
      </div>
      <div class="design-overview-details">
        <section>
          <h3>{{ t('designOverview.computedColors') }}</h3>
          <div class="design-color-groups">
            <div v-for="kind in (['text', 'background', 'border'] as const)" :key="kind">
              <h4>{{ t(`designOverview.colorKinds.${kind}`) }}</h4>
              <ul v-if="designOverviewReport.colors[kind].length" class="design-color-list">
                <li v-for="color in designOverviewReport.colors[kind]" :key="`${kind}-${color.value}`">
                  <span class="design-color-swatch" :style="{ backgroundColor: color.value }" aria-hidden="true"></span>
                  <code>{{ color.value }}</code>
                  <small>{{ localNumber(color.count) }}×</small>
                </li>
              </ul>
              <p v-else>{{ t('designOverview.noVisibleColors', { kind: t(`designOverview.colorKinds.${kind}`) }) }}</p>
            </div>
          </div>
        </section>
        <section>
          <h3>{{ t('designOverview.typography') }}</h3>
          <div v-if="designOverviewReport.fonts.length" class="design-font-list" role="list">
            <article v-for="font in designOverviewReport.fonts" :key="`${font.family}-${font.sizePx}-${font.weight}-${font.lineHeight}`" role="listitem">
              <strong>{{ font.family || t('designOverview.browserDefault') }}</strong>
              <span>{{ t('designOverview.fontDetails', { size: font.sizePx == null ? t('designOverview.unknownSize') : `${localNumber(font.sizePx)}px`, weight: font.weight || 'normal', line: font.lineHeight || 'normal' }) }}</span>
              <small>{{ t('designOverview.elementCount', { count: localNumber(font.count) }, font.count) }}</small>
            </article>
          </div>
          <p v-else>{{ t('designOverview.noFonts') }}</p>
        </section>
        <section>
          <h3>{{ t('designOverview.contrastHeading') }}</h3>
          <div v-if="designOverviewReport.contrastIssues.length" class="design-contrast-list" role="list">
            <article v-for="issue in designOverviewReport.contrastIssues" :key="`${issue.selector}-${issue.ratio}`" role="listitem">
              <header><code>{{ issue.selector }}</code><strong>{{ localNumber(issue.ratio) }}:1</strong></header>
              <span>{{ t('designOverview.contrastColors', { foreground: issue.foreground, background: issue.background, ratio: localNumber(issue.requiredRatio) }) }}</span>
              <small>{{ t('designOverview.contrastFont', { size: issue.fontSizePx == null ? t('designOverview.unknownSize') : `${localNumber(issue.fontSizePx)}px`, weight: issue.fontWeight }) }}<template v-if="issue.largeText"> {{ t('designOverview.largeText') }}</template></small>
            </article>
          </div>
          <p v-else>{{ t('designOverview.noContrast') }}</p>
        </section>
        <section v-if="designOverviewReport.mediaQueries.length">
          <h3>{{ t('designOverview.mediaQueries') }}</h3>
          <ul class="design-media-list">
            <li v-for="media in designOverviewReport.mediaQueries" :key="media.query"><code>{{ media.query }}</code><small>{{ localNumber(media.count) }}×</small></li>
          </ul>
        </section>
        <details>
          <summary>{{ t('designOverview.scope') }}</summary>
          <ul>
            <li>{{ t('designOverview.caveats.bounded') }}</li>
            <li>{{ t('designOverview.caveats.crossOrigin') }}</li>
            <li>{{ t('designOverview.caveats.contrast') }}</li>
            <li>{{ t('designOverview.caveats.excluded') }}</li>
          </ul>
        </details>
      </div>
      <footer>
        <span>{{ t('designOverview.sampled', { count: localNumber(designOverviewReport.summary.elementsScanned) }, designOverviewReport.summary.elementsScanned) }} · {{ debugTimestamp(designOverviewReport.capturedAt) }}</span>
        <UiButton appearance="application" type="button" @click="runDesignOverview"><IconRefresh aria-hidden="true" /> {{ t('designOverview.captureAgain') }}</UiButton>
      </footer>
    </template>
  </section>
</template>
