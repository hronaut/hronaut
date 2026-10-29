<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconWorkspacesOutline from '~icons/material-symbols/workspaces-outline'
import UiButton from '../ui/UiButton.vue'
import UiDialog from '../ui/UiDialog.vue'
import UiField from '../ui/UiField.vue'
import UiInput from '../ui/UiInput.vue'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import { MAX_CREDENTIAL_LENGTH } from '../../../shared/trusted-dialogs.js'
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

/**
 * What the person types to sign in to a website. It stays in this dialog until they sign in, and is gone once they
 * answer or the next dialog replaces this one.
 */
const username = ref('')
const password = ref('')
const usernameField = ref<{ $el?: HTMLElement } | null>(null)
const passwordField = ref<{ $el?: HTMLElement } | null>(null)
const details = ref<HTMLElement | null>(null)
/**
 * Whether the dialog shown came moments after a sign-in closed before the person answered it, as when the page that
 * asked loads another: they may still be typing their password, which must not land in this one's fields.
 */
const afterInterruptedSignIn = ref(false)

/**
 * Where the focus goes when a dialog opens or takes answers: the safe button, or for a sign-in, Username, where a key
 * the person still holds from the page presses nothing. A dialog that came moments after a sign-in the person may still
 * be typing in focuses its text, where neither the rest of their password nor Enter does anything, so they click or
 * Tab to an answer or a field.
 */
function focusSafeControl(): void {
  if (afterInterruptedSignIn.value) details.value?.focus({ preventScroll: true })
  else if (copy.value?.signIn) usernameField.value?.$el?.focus({ preventScroll: true })
  else defaultButton.value?.focus({ preventScroll: true })
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
    // A key meant for the page, such as Tab, may have moved the focus to another answer meanwhile; the safe control
    // takes it back, so the next key meant for the page does not press that answer either. A field of a sign-in the
    // person moved to keeps it, since a key there presses nothing.
    const dialog = document.querySelector('.trusted-dialog')
    const active = document.activeElement
    const inField = active instanceof HTMLInputElement && Boolean(dialog?.contains(active))
    if (!inField && (!active || active === document.body || dialog?.contains(active))) focusSafeControl()
  }, ARM_DELAY_MS)
}, { immediate: true })

watch(() => request.value?.id, async (id) => {
  username.value = ''
  password.value = ''
  const interruptedSignIn = props.controller.afterInterruptedSignIn.value
  afterInterruptedSignIn.value = Boolean(id) && interruptedSignIn
  await nextTick()
  if (!id) {
    // The dialog gave the focus back to the shell control the person last used, such as the address field, and main
    // keeps the page from the keyboard; the rest of a password typed into a sign-in that closed goes to neither.
    if (interruptedSignIn && !request.value && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    return
  }
  // The next dialog in the queue replaces this one in place, so the focus moves to its safe control too.
  if (request.value?.id === id) focusSafeControl()
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
 * moves the focus here. Escape's first press still denies. In a sign-in's field, where a key presses nothing, a held
 * key repeats as in any field, such as Backspace deleting, except Enter and Tab.
 */
function ignoreHeldKeys(event: KeyboardEvent): void {
  if (!event.repeat) return
  if (event.target instanceof HTMLInputElement && event.key !== 'Enter' && event.key !== 'Tab' && event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
}

function choose(index: number): void {
  const current = request.value
  if (!current || !armed.value) return
  // Signing in sends what the person typed; any other answer sends none of it.
  const signingIn = current.variant.kind === 'http-auth' && index === current.primaryId
  props.controller.respond(current.id, index, signingIn ? { username: username.value, password: password.value } : undefined)
  username.value = ''
  password.value = ''
}

/** Signs in with what the person typed, once the dialog takes answers. */
function signIn(): void {
  const primaryId = request.value?.primaryId
  if (primaryId !== undefined) choose(primaryId)
}

/**
 * Enter in Username moves to Password, and Enter in Password signs in, unless it ends a word the person composes, as in
 * Japanese input; so Enter that ends a password typed into Username never sends it.
 */
function enterSignsIn(event: KeyboardEvent): void {
  if (event.isComposing) return
  event.preventDefault()
  if (event.target === usernameField.value?.$el) passwordField.value?.$el?.focus({ preventScroll: true })
  else signIn()
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
    data-above-modals
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
    <!-- A dialog that came moments after a sign-in closed focuses its text, which no key the person still types presses. -->
    <div
      v-if="copy && (afterInterruptedSignIn || copy.quoted || copy.phrase || copy.change || copy.signIn || copy.lines.length || copy.workspaceLine)"
      ref="details"
      class="trusted-dialog__details"
      :tabindex="afterInterruptedSignIn ? -1 : undefined"
      :autofocus="afterInterruptedSignIn || undefined"
      data-testid="trusted-dialog-details"
    >
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
          <span :id="`trusted-dialog-change-${entry.kind}-label`" class="trusted-dialog__change-label"><span class="trusted-dialog__change-mark" aria-hidden="true">{{ entry.kind === 'added' ? '+' : '-' }}</span>{{ entry.label }}</span>
          <!-- Long entries scroll; the region takes the focus so the keyboard can scroll it too. -->
          <pre role="region" tabindex="0" :aria-labelledby="`trusted-dialog-change-${entry.kind}-label`" :data-testid="`trusted-dialog-change-${entry.kind}`"><code>{{ entry.text }}</code></pre>
          <p v-if="entry.note" class="trusted-dialog__change-note">{{ entry.note }}</p>
        </div>
      </figure>
      <!-- The fields take no typing until the dialog takes answers, so keys meant for the page do not land in them. -->
      <form v-if="copy.signIn" class="trusted-dialog__sign-in" data-testid="trusted-dialog-sign-in" @submit.prevent="signIn" @keydown.enter="enterSignsIn">
        <UiField :label="copy.signIn.username" for-id="trusted-dialog-username">
          <UiInput
            ref="usernameField"
            v-model="username"
            :autofocus="!afterInterruptedSignIn || undefined"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :maxlength="MAX_CREDENTIAL_LENGTH"
            :readonly="!armed || controller.answering.value"
            data-testid="trusted-dialog-username"
          />
        </UiField>
        <UiField :label="copy.signIn.password" for-id="trusted-dialog-password">
          <UiInput
            ref="passwordField"
            v-model="password"
            type="password"
            autocomplete="off"
            :maxlength="MAX_CREDENTIAL_LENGTH"
            :readonly="!armed || controller.answering.value"
            data-testid="trusted-dialog-password"
          />
        </UiField>
      </form>
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
        :autofocus="(index === request?.defaultId && !copy?.signIn && !afterInterruptedSignIn) || undefined"
        :aria-disabled="!armed || controller.answering.value || undefined"
        :data-response="index"
        @click="choose(index)"
      >
        {{ label }}
      </UiButton>
    </template>
  </UiDialog>
</template>
