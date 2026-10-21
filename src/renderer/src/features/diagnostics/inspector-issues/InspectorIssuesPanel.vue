<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconClose from '~icons/material-symbols/close-rounded'
import IconDelete from '~icons/material-symbols/delete-outline-rounded'
import IconDownload from '~icons/material-symbols/download-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconWarning from '~icons/material-symbols/warning-rounded'
import { INSPECTOR_ISSUE_METADATA } from '../../../../../shared/browser-issues'
import { formatNumber } from '../../../../../shared/format'
import type { BrowserInspectorIssue, PanelDock, SupportedLocale } from '../../../../../shared/types'
import type { DiagnosticsController } from '../useDiagnosticsController'
import PanelDockPicker from '../../../components/PanelDockPicker.vue'

const props = defineProps<{
  locale: SupportedLocale
  controller: DiagnosticsController
  keepsSeparatePanelOpen: () => boolean
}>()
const dock = defineModel<PanelDock>('dock', { required: true })
const { t } = useI18n({ useScope: 'global' })
const {
  inspectorIssuesOpen,
  inspectorIssuesState,
  inspectorIssuesReport,
  inspectorIssuesError,
  inspectorIssuesCopied,
  refreshInspectorIssues,
  clearInspectorIssues,
  copyInspectorIssues
} = props.controller

// Docked back from its window, the panel was open all along, so it reads the tab's issues again instead of showing what it
// had before it left. The panel window itself is closing then, and a request still running answers for itself.
watch(dock, (next, previous) => {
  if (inspectorIssuesOpen.value && previous === 'window' && next !== 'window' && !props.keepsSeparatePanelOpen() && inspectorIssuesState.value !== 'loading') void refreshInspectorIssues()
})

function localNumber(value: number): string {
  return formatNumber(props.locale, value)
}

// Known Chromium issue codes read in the interface language; another code keeps the title main derived from it.
function issueTitle(issue: BrowserInspectorIssue): string {
  return Object.hasOwn(INSPECTOR_ISSUE_METADATA, issue.code) ? t(`browserIssueTitles.${issue.code}`) : issue.title
}
</script>

<template>
  <section
    v-if="inspectorIssuesOpen"
    class="accessibility-panel inspector-issues-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="inspector-issues-title"
    :aria-busy="inspectorIssuesState === 'loading'"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('issues.kicker') }}</span>
        <h2 id="inspector-issues-title">{{ t('issues.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panelDocks.issues')" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('issues.close')" @click="inspectorIssuesOpen = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="inspectorIssuesState === 'loading'" class="accessibility-audit-loading" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" />
      <strong>{{ t('issues.loading') }}</strong>
      <span>{{ t('issues.privacy') }}</span>
    </div>
    <div v-else-if="inspectorIssuesState === 'error'" class="accessibility-audit-error" role="alert">
      <IconError aria-hidden="true" />
      <strong>{{ t('issues.failed') }}</strong>
      <span>{{ inspectorIssuesError }}</span>
      <UiButton appearance="application" type="button" @click="refreshInspectorIssues()">{{ t('issues.tryAgain') }}</UiButton>
    </div>
    <template v-else-if="inspectorIssuesReport">
      <div class="inspector-issues-summary">
        <article class="error"><strong>{{ localNumber(inspectorIssuesReport.errorCount) }}</strong><span>{{ t('issues.pageErrors') }}</span></article>
        <article class="warning"><strong>{{ localNumber(inspectorIssuesReport.warningCount) }}</strong><span>{{ t('issues.warnings') }}</span></article>
        <article><strong>{{ localNumber(inspectorIssuesReport.infoCount) }}</strong><span>{{ t('issues.improvements') }}</span></article>
      </div>
      <div v-if="!inspectorIssuesReport.issues.length" class="accessibility-audit-empty inspector-issues-empty">
        <IconCheck aria-hidden="true" />
        <strong>{{ t('issues.empty') }}</strong>
        <span>{{ t('issues.emptyDescription') }}</span>
      </div>
      <div v-else class="inspector-issues-list">
        <article v-for="issue in inspectorIssuesReport.issues" :key="issue.id" class="inspector-issue" :class="issue.severity">
          <header>
            <span class="inspector-issue-icon" aria-hidden="true"><IconError v-if="issue.severity === 'error'" /><IconWarning v-else-if="issue.severity === 'warning'" /><IconInfo v-else /></span>
            <span><strong>{{ issueTitle(issue) }}</strong><small>{{ issue.code }}</small></span>
          </header>
          <small v-if="issue.cspDisposition">{{ t(`issues.cspDisposition.${issue.cspDisposition}`) }}</small>
          <ul v-if="issue.reasons.length" class="inspector-issue-reasons">
            <li v-for="reason in issue.reasons" :key="reason"><code>{{ reason }}</code></li>
          </ul>
          <div v-if="issue.affectedUrls.length" class="inspector-issue-urls">
            <span>{{ t('issues.affected') }}</span>
            <code v-for="url in issue.affectedUrls" :key="url">{{ url }}</code>
          </div>
          <small v-if="issue.source" class="inspector-issue-source">{{ issue.source.url }}<template v-if="issue.source.lineNumber">:{{ issue.source.lineNumber }}<template v-if="issue.source.columnNumber">:{{ issue.source.columnNumber }}</template></template></small>
        </article>
        <p v-if="inspectorIssuesReport.truncated" class="inspector-issues-truncated"><IconInfo aria-hidden="true" /> {{ t('issues.truncated') }}</p>
        <details class="debug-report-caveats">
          <summary>{{ t('issues.sharing') }}</summary>
          <ul>
            <li>{{ t('issues.caveats.scope') }}</li>
            <li>{{ t('issues.caveats.privacy') }}</li>
            <li>{{ inspectorIssuesReport.devToolsOpen ? t('issues.caveats.devtools') : t('issues.caveats.reload') }}</li>
          </ul>
        </details>
      </div>
      <footer>
        <span>{{ t('issues.count', { count: localNumber(inspectorIssuesReport.issueCount) }, inspectorIssuesReport.issueCount) }} {{ t('issues.review') }}</span>
        <div class="debug-report-actions">
          <UiButton appearance="application" type="button" @click="clearInspectorIssues"><IconDelete aria-hidden="true" /> {{ t('issues.clear') }}</UiButton>
          <UiButton appearance="application" type="button" @click="refreshInspectorIssues()"><IconRefresh aria-hidden="true" /> {{ t('issues.refresh') }}</UiButton>
          <UiButton appearance="application" variant="primary" type="button" class="primary" :disabled="!inspectorIssuesReport.issueCount" @click="copyInspectorIssues">
            <IconCheck v-if="inspectorIssuesCopied" aria-hidden="true" />
            <IconDownload v-else aria-hidden="true" />
            {{ inspectorIssuesCopied ? t('issues.copied') : t('issues.copy') }}
          </UiButton>
        </div>
      </footer>
    </template>
  </section>
</template>
