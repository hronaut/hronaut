<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconWorkspacesOutline from '~icons/material-symbols/workspaces-outline'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import { pageViewsHidden } from '../composables/overlay-motion.js'
import { trustedDialogCopy } from './trusted-dialog-copy.js'
import type { TrustedDialogController } from './useTrustedDialogController.js'

const props = defineProps<{ controller: TrustedDialogController }>()
const { t } = useI18n({ useScope: 'global' })
const translate = (key: MessageKey, parameters?: MessageParameters): string => t(key, parameters ?? {})

const request = computed(() => props.controller.request.value)
const copy = computed(() => request.value ? trustedDialogCopy(request.value, translate) : null)
const headlineText = computed(() => {
  const headline = copy.value?.headline
  return headline ? `${headline.before}${headline.emphasis}${headline.after}` : ''
})

/**
 * A dialog takes no answer until it has been on screen for a moment: a website can time a request so that a click
 * or key aimed at its page lands on Allow the instant the dialog appears. The moment starts only once the person can
 * see and use the dialog: main has reported that the page views left the screen, and the window shows and has the
 * focus. So neither a click on a page still on screen while main takes its picture, however long main takes, nor the
 * click that brings the window back answers.
 */
const ARM_DELAY_MS = 500
const armedId = ref<string>()
let armTimer: ReturnType<typeof setTimeout> | undefined
const armed = computed(() => Boolean(request.value && armedId.value === request.value.id))
const documentVisible = ref(document.visibilityState === 'visible')
const windowFocused = ref(document.hasFocus())
/** The request the person can see and use now, whose moment on screen runs. */
const presentedId = computed(() => (
  request.value && documentVisible.value && windowFocused.value && pageViewsHidden.value ? request.value.id : undefined
))

const defaultButton = ref<{ focus(options?: { preventScroll?: boolean }): void } | null>(null)
function setButtonRef(index: number, element: unknown): void {
  if (index === request.value?.defaultId) defaultButton.value = element as typeof defaultButton.value
}

function disarm(): void {
  if (armTimer !== undefined) clearTimeout(armTimer)
  armTimer = undefined
  armedId.value = undefined
}

watch(presentedId, (id) => {
  disarm()
  if (!id) return
  armTimer = setTimeout(() => {
    armTimer = undefined
    if (presentedId.value !== id) return
    armedId.value = id
    // A key meant for the page, such as Tab, may have moved the focus to another answer meanwhile; the safe one takes
    // it back, so the next key meant for the page does not press that answer either.
    const dialog = document.querySelector('.trusted-dialog')
    if (!document.activeElement || document.activeElement === document.body || dialog?.contains(document.activeElement)) {
      defaultButton.value?.focus({ preventScroll: true })
    }
  }, ARM_DELAY_MS)
}, { immediate: true })

watch(() => request.value?.id, async (id) => {
  if (!id) return
  // The next dialog in the queue replaces this one in place, so the focus moves to its safe button too.
  await nextTick()
  if (request.value?.id === id) defaultButton.value?.focus({ preventScroll: true })
}, { immediate: true })

function visibilityChanged(): void {
  documentVisible.value = document.visibilityState === 'visible'
}
function windowFocusChanged(event: FocusEvent): void {
  windowFocused.value = event.type === 'focus'
}
document.addEventListener('visibilitychange', visibilityChanged)
window.addEventListener('focus', windowFocusChanged)
window.addEventListener('blur', windowFocusChanged)
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', visibilityChanged)
  window.removeEventListener('focus', windowFocusChanged)
  window.removeEventListener('blur', windowFocusChanged)
  disarm()
})

/**
 * A key held since before the dialog opened, such as Enter or Tab on the page, repeats; it never presses a button or
 * moves the focus here. Escape's first press still denies.
 */
function ignoreHeldKeys(event: KeyboardEvent): void {
  if (!event.repeat) return
  event.preventDefault()
  event.stopPropagation()
}

function choose(index: number): void {
  const current = request.value
  if (!current || !armed.value) return
  props.controller.respond(current.id, index)
}

function openChanged(open: boolean): void {
  if (!open) props.controller.cancel()
}

function buttonVariant(index: number): 'primary' | 'secondary' {
  return index === request.value?.primaryId ? 'primary' : 'secondary'
}
</script>

<template>
  <UiDialog
    :open="Boolean(request && copy)"
    :title="headlineText"
    :description="copy?.description"
    role="alertdialog"
    :close-label="t('trustedDialogs.close')"
    :close-on-backdrop="false"
    class="trusted-dialog"
    :class="[`trusted-dialog--${copy?.tone ?? 'info'}`, { 'trusted-dialog--arming': !armed }]"
    data-testid="trusted-dialog"
    :data-variant="request?.variant.kind"
    :data-topic="request?.variant.kind === 'message' ? request.variant.topic : undefined"
    :data-request-id="request?.id"
    :data-armed="armed ? 'true' : 'false'"
    @update:open="openChanged"
    @keydown.capture="ignoreHeldKeys"
  >
    <template #icon><component :is="copy.icon" v-if="copy" class="trusted-dialog__icon" /></template>
    <template #eyebrow><span v-if="copy?.eyebrow" class="trusted-dialog__eyebrow">{{ copy.eyebrow }}</span></template>
    <template #title>
      <template v-if="copy">{{ copy.headline.before }}<strong v-if="copy.headline.emphasis" class="trusted-dialog__origin">{{ copy.headline.emphasis }}</strong>{{ copy.headline.after }}</template>
    </template>
    <div v-if="copy && (copy.quoted || copy.phrase || copy.change || copy.lines.length || copy.workspaceLine)" class="trusted-dialog__details">
      <!-- The phrase leaves the screen as soon as the person answers, before main closes the dialog. -->
      <ol v-if="copy.phrase && !controller.answering.value" class="trusted-dialog__phrase" :aria-label="copy.phrase.label" data-testid="trusted-dialog-phrase">
        <li v-for="(word, index) in copy.phrase.words" :key="index">
          <span class="trusted-dialog__phrase-number" aria-hidden="true">{{ index + 1 }}</span>
          <span>{{ word }}</span>
        </li>
      </ol>
      <figure v-if="copy.change" class="trusted-dialog__change" data-testid="trusted-dialog-change">
        <figcaption>
          <span>{{ copy.change.fileLabel }}</span>
          <code class="trusted-dialog__change-path" data-testid="trusted-dialog-change-path">{{ copy.change.path }}</code>
        </figcaption>
        <div v-for="entry in copy.change.entries" :key="entry.kind" :class="['trusted-dialog__change-entry', `trusted-dialog__change-entry--${entry.kind}`]">
          <span class="trusted-dialog__change-label"><span class="trusted-dialog__change-mark" aria-hidden="true">{{ entry.kind === 'added' ? '+' : '-' }}</span>{{ entry.label }}</span>
          <!-- Long entries scroll; the region takes the focus so the keyboard can scroll it too. -->
          <pre role="region" tabindex="0" :aria-label="entry.label" :data-testid="`trusted-dialog-change-${entry.kind}`"><code>{{ entry.text }}</code></pre>
        </div>
      </figure>
      <figure v-if="copy.quoted" class="trusted-dialog__quoted">
        <figcaption v-if="copy.quotedLabel">{{ copy.quotedLabel }}</figcaption>
        <code data-testid="trusted-dialog-quoted">{{ copy.quoted }}</code>
      </figure>
      <p v-if="copy.workspaceLine" class="trusted-dialog__workspace">
        <IconWorkspacesOutline aria-hidden="true" />
        <span>{{ copy.workspaceLine }}</span>
      </p>
      <p v-for="(line, index) in copy.lines" :key="index" class="trusted-dialog__line">{{ line }}</p>
    </div>
    <template #footer>
      <UiButton
        v-for="(label, index) in request?.buttons ?? []"
        :key="`${request?.id}:${index}`"
        :ref="(element) => setButtonRef(index, element)"
        :variant="buttonVariant(index)"
        :autofocus="index === request?.defaultId || undefined"
        :aria-disabled="!armed || controller.answering.value || undefined"
        :data-response="index"
        @click="choose(index)"
      >
        {{ label }}
      </UiButton>
    </template>
  </UiDialog>
</template>
