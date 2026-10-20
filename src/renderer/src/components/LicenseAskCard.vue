<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IconCheck from '~icons/material-symbols/check-rounded'
import IconKey from '~icons/material-symbols/key-rounded'
import { UiButton } from '../ui/index.js'
import type { LicenseAskReason } from '../features/settings/support/useLicenseAsk.js'
import { ignoreHeldEnter } from '../held-enter.js'
const { t } = useI18n({ useScope: 'global' })
const props = defineProps<{ reason: LicenseAskReason | null }>()
defineEmits<{ manage: []; purchase: []; dismiss: [] }>()

const description = computed(() => t(props.reason === 'license-ended' ? 'licenseNotice.licenseEnded' : 'licenseNotice.trialEnded'))
const benefits = computed(() => [t('licenseNotice.benefitWorkspaces'), t('licenseNotice.benefitBrowser'), t('licenseNotice.benefitTakeOver')])
</script>

<template>
  <!-- Mounted all along, so that screen readers announce access ending; a live region that arrives filled is not. -->
  <span class="sr-only" role="status">{{ reason ? description : '' }}</span>
  <section v-if="reason" class="license-ask" aria-labelledby="license-ask-title">
    <div class="license-ask-panel">
      <span class="license-ask-mark" aria-hidden="true"><IconKey /></span>
      <div class="license-ask-copy">
        <strong id="license-ask-title">{{ t('licenseNotice.title') }}</strong>
        <p>{{ description }}</p>
        <ul class="license-ask-benefits">
          <li v-for="benefit in benefits" :key="benefit"><IconCheck aria-hidden="true" />{{ benefit }}</li>
        </ul>
      </div>
      <div class="license-ask-offer">
        <span class="license-ask-price">{{ t('licenseNotice.price') }}</span>
        <!-- After a paid license, License settings comes first: it may only need checking again after time offline. -->
        <div class="license-ask-actions">
          <UiButton v-if="reason === 'license-ended'" variant="primary" @keydown="ignoreHeldEnter" @click="$emit('manage')">{{ t('licenseNotice.manage') }}</UiButton>
          <UiButton :variant="reason === 'license-ended' ? 'secondary' : 'primary'" @keydown="ignoreHeldEnter" @click="$emit('purchase')">{{ t('licenseNotice.buy') }}</UiButton>
          <UiButton v-if="reason === 'trial-ended'" @keydown="ignoreHeldEnter" @click="$emit('manage')">{{ t('licenseNotice.enterKey') }}</UiButton>
          <UiButton variant="ghost" @keydown="ignoreHeldEnter" @click="$emit('dismiss')">{{ t('licenseNotice.dismiss') }}</UiButton>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.license-ask {
  position: relative;
  container-type: inline-size;
  padding: 8px 12px;
  /* Only the color: the shell stylesheet adds the workspace wash as an image. */
  background-color: var(--shell-bar, var(--toolbar));
  border-top: 1px solid var(--border-soft);
}
.vertical-tabs-shell .license-ask { margin-left: var(--tab-rail-width); }
.license-ask-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  padding: 12px 14px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border-soft));
  border-radius: var(--corner-3);
  background: linear-gradient(110deg, color-mix(in srgb, var(--accent) 13%, var(--surface)), color-mix(in srgb, var(--accent) 4%, var(--surface)) 62%);
  box-shadow: 0 1px 2px var(--shadow);
}
.license-ask-mark {
  display: grid;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: var(--corner-2);
  color: var(--button-text);
  background: var(--accent);
}
.license-ask-mark svg { width: 22px; height: 22px; }
.license-ask-copy { display: grid; flex: 1 1 320px; gap: 3px; min-width: 0; }
.license-ask-copy strong { color: var(--text); font-size: var(--type-title-size); font-weight: var(--weight-strong); }
.license-ask-copy p { margin: 0; color: var(--muted); font-size: var(--type-body-size); line-height: 1.45; }
.license-ask-benefits { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 3px 0 0; padding: 0; list-style: none; }
.license-ask-benefits li { display: flex; align-items: center; gap: 4px; color: var(--text); font-size: var(--type-small-size); }
.license-ask-benefits svg { flex: none; width: 15px; height: 15px; color: var(--accent-text); }
.license-ask-offer { display: grid; flex: 0 1 auto; justify-items: end; gap: 7px; }
.license-ask-price { color: var(--text); font-size: var(--type-small-size); font-weight: var(--weight-strong); }
.license-ask-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
@container (max-width: 720px) {
  .license-ask-offer { justify-items: start; }
  .license-ask-actions { justify-content: flex-start; }
}
</style>
