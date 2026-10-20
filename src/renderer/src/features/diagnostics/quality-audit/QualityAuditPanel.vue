<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconCopy from '~icons/material-symbols/content-copy-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { formatNumber, formatTime } from '../../../../../shared/format'
import type { PanelDock, SupportedLocale } from '../../../../../shared/types'
import type { DiagnosticsController } from '../useDiagnosticsController'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  qualityAuditState,
  qualityAuditReport,
  qualityAuditError,
  qualityAuditPanelOpen,
  qualityAuditCopied,
  runQualityAudit,
  copyQualityAudit
} = props.controller

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

function localTime(value: Date | number | string): string {
  return formatTime(props.locale, value)
}
</script>

<template>
  <section
    v-if="qualityAuditPanelOpen"
    class="accessibility-panel quality-audit-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="quality-audit-panel-title"
    :aria-busy="qualityAuditState === 'running'"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('qualityAudit.kicker') }}</span>
        <h2 id="quality-audit-panel-title">{{ t('qualityAudit.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('qualityAudit.heading') })" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('qualityAudit.close')" @click="qualityAuditPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="qualityAuditState === 'running'" class="accessibility-audit-loading" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" />
      <strong>{{ t('qualityAudit.checking') }}</strong>
      <span>{{ t('qualityAudit.privacy') }}</span>
    </div>
    <div v-else-if="qualityAuditState === 'error'" class="accessibility-audit-error" role="alert">
      <IconError aria-hidden="true" />
      <strong>{{ t('qualityAudit.failed') }}</strong>
      <span>{{ qualityAuditError }}</span>
      <UiButton appearance="application" type="button" @click="runQualityAudit">{{ t('common.tryAgain') }}</UiButton>
    </div>
    <template v-else-if="qualityAuditReport">
      <div class="quality-audit-summary" :class="qualityAuditReport.status">
        <IconCheck v-if="qualityAuditReport.status === 'pass'" aria-hidden="true" />
        <IconWarning v-else-if="qualityAuditReport.status === 'warning'" aria-hidden="true" />
        <IconError v-else aria-hidden="true" />
        <span>
          <strong>{{ qualityAuditReport.status === 'pass' ? t('qualityAudit.clear') : qualityAuditReport.status === 'warning' ? t('qualityAudit.review') : t('qualityAudit.attention') }}</strong>
          <small>{{ qualityAuditReport.totals.errors }} {{ t('qualityAudit.errors', qualityAuditReport.totals.errors) }} · {{ qualityAuditReport.totals.warnings }} {{ t('qualityAudit.warnings', qualityAuditReport.totals.warnings) }} · {{ qualityAuditReport.totals.info }} {{ t('qualityAudit.information', qualityAuditReport.totals.info) }}</small>
        </span>
      </div>
      <div class="quality-audit-content">
        <section class="quality-audit-categories" :aria-label="t('qualityAudit.categories')">
          <article v-for="category in qualityAuditReport.categories" :key="category.id" :class="category.status">
            <header>
              <strong>{{ category.label }}</strong>
              <span>{{ category.status.replace('-', ' ') }}</span>
            </header>
            <p>{{ category.summary }}</p>
            <ul>
              <li v-for="item in category.evidence" :key="item">{{ item }}</li>
            </ul>
          </article>
        </section>
        <section v-if="qualityAuditReport.findings.length" class="quality-audit-findings" aria-labelledby="quality-audit-findings-title">
          <h3 id="quality-audit-findings-title">{{ t('qualityAudit.findings') }}</h3>
          <article v-for="(finding, index) in qualityAuditReport.findings" :key="`${finding.category}-${finding.code}-${index}`" :class="finding.severity">
            <header><span>{{ finding.severity }}</span><strong>{{ finding.code }}</strong><small>{{ finding.category }}</small></header>
            <p>{{ finding.message }}</p>
          </article>
          <p v-if="qualityAuditReport.truncated" class="quality-audit-truncated">{{ t('qualityAudit.truncated') }}</p>
        </section>
        <details class="quality-audit-caveats">
          <summary>{{ t('qualityAudit.limitations') }}</summary>
          <ul><li v-for="caveat in qualityAuditReport.caveats" :key="caveat">{{ caveat }}</li></ul>
        </details>
      </div>
      <footer>
        <span>{{ t('qualityAudit.categoryCount', { count: localNumber(qualityAuditReport.categories.length), time: localTime(qualityAuditReport.auditedAt) }) }}</span>
        <div>
          <UiButton appearance="application" type="button" @click="copyQualityAudit"><IconCheck v-if="qualityAuditCopied" aria-hidden="true" /><IconCopy v-else aria-hidden="true" /> {{ qualityAuditCopied ? t('qualityAudit.copied') : t('qualityAudit.copy') }}</UiButton>
          <UiButton appearance="application" type="button" @click="runQualityAudit"><IconRefresh aria-hidden="true" /> {{ t('qualityAudit.runAgain') }}</UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
