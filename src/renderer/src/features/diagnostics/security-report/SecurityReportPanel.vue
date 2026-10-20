<script setup lang="ts">
import UiButton from "../../../ui/UiButton.vue"
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconClose from '~icons/material-symbols/close-rounded'
import IconError from '~icons/material-symbols/error-outline-rounded'
import IconInfo from '~icons/material-symbols/info-rounded'
import IconProgress from '~icons/material-symbols/progress-activity-rounded'
import IconRefresh from '~icons/material-symbols/refresh-rounded'
import IconShieldLock from '~icons/material-symbols/shield-lock-rounded'
import { formatDateTime, formatNumber } from '../../../../../shared/format'
import type { PanelDock, SupportedLocale } from '../../../../../shared/types'
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
  securityPanelOpen,
  securityReport,
  securityReportState,
  securityReportError,
  runSecurityReport
} = props.controller

// Docked back from its window after the page changed, the panel has nothing to show: the main window cleared its report
// for the new page while it was away. It runs again for the page shown now, as its window did. The panel window itself
// is closing then.
watch(dock, (next, previous) => {
  if (securityPanelOpen.value && previous === 'window' && next !== 'window' && !props.keepsSeparatePanelOpen() && securityReportState.value === 'idle' && !securityReport.value) void runSecurityReport()
})

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

function formatSecurityDate(value: string): string {
  const date = new Date(value)
  if (!value || Number.isNaN(date.valueOf())) return t('securityReport.unavailable')
  return formatDateTime(props.locale, date, { dateStyle: 'medium', timeStyle: 'short' })
}
</script>

<template>
  <section
    v-if="securityPanelOpen"
    class="accessibility-panel security-panel"
    data-shell-docked-panel
    role="dialog"
    aria-modal="false"
    aria-labelledby="security-panel-title"
    :aria-busy="securityReportState === 'loading'"
  >
    <header>
      <div>
        <span class="eyebrow">{{ t('securityReport.kicker') }}</span>
        <h2 id="security-panel-title">{{ t('securityReport.heading') }}</h2>
      </div>
      <div class="panel-header-actions">
        <PanelDockPicker v-model="dock" :label="t('panels.dockNamed', { panel: t('securityReport.heading') })" />
        <UiButton appearance="application" class="panel-close" type="button" :aria-label="t('securityReport.close')" @click="securityPanelOpen = false"><IconClose aria-hidden="true" /></UiButton>
      </div>
    </header>
    <div v-if="securityReportState === 'loading'" class="accessibility-audit-loading" role="status">
      <IconProgress class="state-spinner" aria-hidden="true" />
      <strong>{{ t('securityReport.loading') }}</strong>
      <span>{{ t('securityReport.privacy') }}</span>
    </div>
    <div v-else-if="securityReportState === 'error'" class="accessibility-audit-error" role="alert">
      <IconError aria-hidden="true" />
      <strong>{{ t('securityReport.failed') }}</strong>
      <span>{{ securityReportError }}</span>
      <UiButton appearance="application" type="button" @click="runSecurityReport">{{ t('securityReport.tryAgain') }}</UiButton>
    </div>
    <template v-else-if="securityReport">
      <div class="security-overview" :class="securityReport.state">
        <IconShieldLock aria-hidden="true" />
        <div>
          <strong v-if="securityReport.state === 'secure'">{{ t('securityReport.secure') }}</strong>
          <strong v-else-if="securityReport.state === 'insecure' || securityReport.state === 'insecure-broken'">{{ t('securityReport.insecure') }}</strong>
          <strong v-else>{{ t('securityReport.state', { state: securityReport.state }) }}</strong>
          <span>{{ securityReport.origin || securityReport.url }}</span>
        </div>
        <span class="security-state">{{ securityReport.state }}</span>
      </div>
      <div class="security-details">
        <section>
          <h3>{{ t('securityReport.connection') }}</h3>
          <dl>
            <div><dt>{{ t('securityReport.encryptedTransport') }}</dt><dd>{{ securityReport.secureTransport ? t('securityReport.yes') : t('securityReport.no') }}</dd></div>
            <div><dt>{{ t('securityReport.protocol') }}</dt><dd>{{ securityReport.connection?.protocol || t('securityReport.unavailable') }}</dd></div>
            <div><dt>{{ t('securityReport.cipher') }}</dt><dd>{{ securityReport.connection?.cipher || t('securityReport.unavailable') }}</dd></div>
            <div><dt>{{ t('securityReport.keyExchange') }}</dt><dd>{{ securityReport.connection?.keyExchangeGroup || securityReport.connection?.keyExchange || t('securityReport.unavailable') }}</dd></div>
            <div><dt>{{ t('securityReport.certificateTransparency') }}</dt><dd>{{ securityReport.connection?.certificateTransparencyCompliance || t('securityReport.unavailable') }}</dd></div>
            <div><dt>{{ t('securityReport.encryptedClientHello') }}</dt><dd>{{ securityReport.connection?.encryptedClientHello == null ? t('securityReport.unavailable') : securityReport.connection.encryptedClientHello ? t('securityReport.yes') : t('securityReport.no') }}</dd></div>
          </dl>
        </section>
        <section v-if="securityReport.certificate">
          <h3>{{ t('securityReport.certificate') }}</h3>
          <dl>
            <div class="wide"><dt>{{ t('securityReport.subject') }}</dt><dd>{{ securityReport.certificate.subjectName || t('securityReport.unavailable') }}</dd></div>
            <div class="wide"><dt>{{ t('securityReport.issuer') }}</dt><dd>{{ securityReport.certificate.issuer || t('securityReport.unavailable') }}</dd></div>
            <div><dt>{{ t('securityReport.validFrom') }}</dt><dd>{{ formatSecurityDate(securityReport.certificate.validFrom) }}</dd></div>
            <div><dt>{{ t('securityReport.validUntil') }}</dt><dd>{{ formatSecurityDate(securityReport.certificate.validTo) }}</dd></div>
            <div><dt>{{ t('securityReport.validity') }}</dt><dd :class="{ warning: !securityReport.certificate.valid }">{{ securityReport.certificate.expired ? t('securityReport.expired') : securityReport.certificate.notYetValid ? t('securityReport.notYetValid') : securityReport.certificate.valid ? t('securityReport.currentlyValid') : t('securityReport.unavailable') }}</dd></div>
            <div><dt>{{ t('securityReport.expiresIn') }}</dt><dd>{{ securityReport.certificate.validTo ? t('securityReport.dayCount', { count: localNumber(securityReport.certificate.daysUntilExpiry) }, securityReport.certificate.daysUntilExpiry) : t('securityReport.unavailable') }}</dd></div>
          </dl>
          <details v-if="securityReport.certificate.sanCount">
            <summary>{{ t('securityReport.certificateNames', { count: localNumber(securityReport.certificate.sanCount) }, securityReport.certificate.sanCount) }}</summary>
            <ul><li v-for="name in securityReport.certificate.sanList" :key="name">{{ name }}</li></ul>
            <small v-if="securityReport.certificate.sanCount > securityReport.certificate.sanList.length">{{ t('securityReport.onlyFirstNames', { count: localNumber(securityReport.certificate.sanList.length) }) }}</small>
          </details>
        </section>
        <section v-else class="security-no-certificate">
          <IconInfo aria-hidden="true" />
          <div><strong>{{ t('securityReport.noCertificate') }}</strong><span>{{ t('securityReport.noCertificateDescription') }}</span></div>
        </section>
        <details class="security-caveats">
          <summary>{{ t('securityReport.caveatsHeading') }}</summary>
          <ul>
            <li>{{ t('securityReport.caveats.trust') }}</li>
            <li>{{ t('securityReport.caveats.browserIssues') }}</li>
            <li>{{ t('securityReport.caveats.unavailable') }}</li>
          </ul>
        </details>
      </div>
      <footer>
        <span>{{ t('securityReport.mainChecked', { time: debugTimestamp(securityReport.checkedAt) }) }}</span>
        <UiButton appearance="application" type="button" @click="runSecurityReport"><IconRefresh aria-hidden="true" /> {{ t('securityReport.inspectAgain') }}</UiButton>
      </footer>
    </template>
  </section>
</template>
