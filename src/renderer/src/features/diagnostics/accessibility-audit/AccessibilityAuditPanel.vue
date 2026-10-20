<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import { formatTime } from '../../../../../shared/format'
import type {
  BrowserAccessibilityImpact,
  PanelDock,
  SupportedLocale
} from '../../../../../shared/types'
import type { DiagnosticsController } from '../useDiagnosticsController'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
  openSupport: (url: string) => Promise<void>
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  accessibilityAuditState,
  accessibilityAudit,
  accessibilityAuditError,
  accessibilityPanelOpen,
  runAccessibilityAudit
} = props.controller

function localTime(value: Date | number | string): string {
  return formatTime(props.locale, value)
}

function accessibilityImpactCount(impact: BrowserAccessibilityImpact): number {
  return accessibilityAudit.value?.violations.filter((violation) => violation.impact === impact).length ?? 0
}
</script>

<template>
  <section
    v-if="accessibilityPanelOpen"
    class="accessibility-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="accessibility-panel-title"
    :aria-busy="accessibilityAuditState === 'running'"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('accessibilityAudit.kicker') }}</span>
        <h2 id="accessibility-panel-title">{{ t('accessibilityAudit.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('accessibilityAudit.heading') })" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('accessibilityAudit.close')" @click="accessibilityPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="accessibilityAuditState === 'running'" class="accessibility-audit-loading" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" />
      <strong>{{ t('accessibilityAudit.checking') }}</strong>
      <span>{{ t('accessibilityAudit.privacy') }}</span>
    </div>
    <div v-else-if="accessibilityAuditState === 'error'" class="accessibility-audit-error" role="alert">
      <IconError aria-hidden="true" />
      <strong>{{ t('accessibilityAudit.failed') }}</strong>
      <span>{{ accessibilityAuditError }}</span>
      <UiButton appearance="application" type="button" @click="runAccessibilityAudit()">{{ t('common.tryAgain') }}</UiButton>
    </div>
    <template v-else-if="accessibilityAudit">
      <div class="accessibility-audit-summary">
        <article>
          <strong>{{ accessibilityAudit.violationCount }}</strong>
          <span>{{ t('accessibilityAudit.violations', accessibilityAudit.violationCount) }}</span>
        </article>
        <article class="critical">
          <strong>{{ accessibilityImpactCount('critical') }}</strong>
          <span>{{ t('accessibilityAudit.critical') }}</span>
        </article>
        <article class="serious">
          <strong>{{ accessibilityImpactCount('serious') }}</strong>
          <span>{{ t('accessibilityAudit.serious') }}</span>
        </article>
        <article>
          <strong>{{ accessibilityAudit.needsReviewCount }}</strong>
          <span>{{ t('accessibilityAudit.review') }}</span>
        </article>
      </div>
      <section v-if="accessibilityAudit.baseline" class="accessibility-comparison" aria-labelledby="accessibility-comparison-title">
        <header>
          <div>
            <span class="eyebrow">{{ t('accessibilityAudit.baseline') }}</span>
            <strong id="accessibility-comparison-title">{{ t('accessibilityAudit.comparedWith', { time: localTime(accessibilityAudit.baseline.auditedAt) }) }}</strong>
          </div>
        </header>
        <div v-if="accessibilityAudit.comparison" class="accessibility-comparison-summary">
          <article>
            <strong>{{ accessibilityAudit.comparison.newFindings?.length ?? t('accessibilityAudit.unknown') }}</strong>
            <span>{{ t('accessibilityAudit.newFindings') }}</span>
          </article>
          <article>
            <strong>{{ accessibilityAudit.comparison.remainingFindings?.length ?? t('accessibilityAudit.unknown') }}</strong>
            <span>{{ t('accessibilityAudit.remainingFindings') }}</span>
          </article>
          <article class="resolved">
            <strong>{{ accessibilityAudit.comparison.resolvedFindings?.length ?? t('accessibilityAudit.unknown') }}</strong>
            <span>{{ t('accessibilityAudit.resolvedFindings') }}</span>
          </article>
        </div>
        <template v-if="accessibilityAudit.comparison">
          <section v-for="group in [
            { key: 'new', label: t('accessibilityAudit.newFindings'), findings: accessibilityAudit.comparison.newFindings },
            { key: 'remaining', label: t('accessibilityAudit.remainingFindings'), findings: accessibilityAudit.comparison.remainingFindings },
            { key: 'resolved', label: t('accessibilityAudit.resolvedFindings'), findings: accessibilityAudit.comparison.resolvedFindings }
          ]" :key="group.key" class="accessibility-comparison-findings">
            <strong>{{ group.label }}</strong>
            <span v-if="group.findings === null">{{ t('accessibilityAudit.notComparable') }}</span>
            <span v-else-if="group.findings.length === 0">{{ t('accessibilityAudit.noFindings') }}</span>
            <ul v-else>
              <li v-for="finding in group.findings" :key="`${group.key}-${finding.ruleId}-${finding.targets.join('|')}`">
                <span>{{ finding.help }} · {{ finding.ruleId }}</span>
                <code>{{ finding.targets.join(' → ') }}</code>
              </li>
            </ul>
          </section>
          <ul v-if="accessibilityAudit.comparison.caveats.length" class="accessibility-comparison-caveats">
            <li v-for="caveat in accessibilityAudit.comparison.caveats" :key="caveat">{{ caveat }}</li>
          </ul>
        </template>
        <p v-else>{{ t('accessibilityAudit.measureAfter') }}</p>
      </section>
      <div v-if="!accessibilityAudit.violationCount" class="accessibility-audit-empty">
        <IconCheck aria-hidden="true" />
        <strong>{{ t('accessibilityAudit.clear') }}</strong>
        <span>{{ t('accessibilityAudit.manual') }}</span>
      </div>
      <div v-else class="accessibility-violations">
        <article v-for="violation in accessibilityAudit.violations" :key="violation.id" class="accessibility-violation">
          <header>
            <span class="accessibility-impact" :class="violation.impact">{{ violation.impact }}</span>
            <strong>{{ violation.help }}</strong>
            <small>{{ violation.id }} · {{ violation.nodeCount }} {{ t('accessibilityAudit.elements', violation.nodeCount) }}</small>
          </header>
          <p>{{ violation.description }}</p>
          <ul>
            <li v-for="(node, nodeIndex) in violation.nodes" :key="`${violation.id}-${nodeIndex}`">
              <code>{{ node.targets.join(' → ') }}</code>
              <span>{{ node.failureSummary }}</span>
            </li>
          </ul>
          <UiButton appearance="application" v-if="violation.helpUrl" type="button" @click="openSupport(violation.helpUrl)">{{ t('accessibilityAudit.guidance') }}</UiButton>
        </article>
      </div>
      <footer>
        <span>{{ accessibilityAudit.engine.name }} {{ accessibilityAudit.engine.version }} · {{ accessibilityAudit.standard }}</span>
        <div>
          <UiButton v-if="accessibilityAudit.baseline" appearance="application" type="button" @click="runAccessibilityAudit('clear-baseline')">{{ t('accessibilityAudit.clearBaseline') }}</UiButton>
          <UiButton appearance="application" type="button" @click="runAccessibilityAudit('set-baseline')">{{ accessibilityAudit.baseline ? t('accessibilityAudit.replaceBaseline') : t('accessibilityAudit.saveBaseline') }}</UiButton>
          <UiButton appearance="application" type="button" @click="runAccessibilityAudit()"><IconRefresh aria-hidden="true" /> {{ t('accessibilityAudit.runAgain') }}</UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
