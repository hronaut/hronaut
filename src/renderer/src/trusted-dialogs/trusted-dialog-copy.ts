import type { Component } from 'vue'
import IconVideocamOutlineRounded from '~icons/material-symbols/videocam-outline-rounded'
import IconMicOutlineRounded from '~icons/material-symbols/mic-outline-rounded'
import IconVideocamRounded from '~icons/material-symbols/videocam-rounded'
import IconLocationOnOutlineRounded from '~icons/material-symbols/location-on-outline-rounded'
import IconNotificationsOutlineRounded from '~icons/material-symbols/notifications-outline-rounded'
import IconContentPasteRounded from '~icons/material-symbols/content-paste-rounded'
import IconPianoOutlineRounded from '~icons/material-symbols/piano-outline-rounded'
import IconFolderOpenOutlineRounded from '~icons/material-symbols/folder-open-outline-rounded'
import IconOpenInNewRounded from '~icons/material-symbols/open-in-new-rounded'
import IconFullscreenRounded from '~icons/material-symbols/fullscreen-rounded'
import IconDirectionsWalkRounded from '~icons/material-symbols/directions-walk-rounded'
import IconKeyboardOutlineRounded from '~icons/material-symbols/keyboard-outline-rounded'
import IconMouseOutlineRounded from '~icons/material-symbols/mouse-outline-rounded'
import IconDatabaseOutline from '~icons/material-symbols/database-outline'
import IconLightModeOutlineRounded from '~icons/material-symbols/light-mode-outline-rounded'
import IconCookieOutlineRounded from '~icons/material-symbols/cookie-outline-rounded'
import IconSelectWindowRounded from '~icons/material-symbols/select-window-rounded'
import IconScreenShareOutlineRounded from '~icons/material-symbols/screen-share-outline-rounded'
import IconShieldQuestionOutlineRounded from '~icons/material-symbols/shield-question-outline-rounded'
import IconGppMaybeOutlineRounded from '~icons/material-symbols/gpp-maybe-outline-rounded'
import IconInfoOutlineRounded from '~icons/material-symbols/info-outline-rounded'
import IconWarningOutlineRounded from '~icons/material-symbols/warning-outline-rounded'
import IconErrorOutlineRounded from '~icons/material-symbols/error-outline-rounded'
import IconHelpOutlineRounded from '~icons/material-symbols/help-outline-rounded'
import IconKeyOutlineRounded from '~icons/material-symbols/key-outline-rounded'
import IconEditNoteOutlineRounded from '~icons/material-symbols/edit-note-outline-rounded'
import IconDownloadRounded from '~icons/material-symbols/download-rounded'
import IconMoveToInboxOutlineRounded from '~icons/material-symbols/move-to-inbox-outline-rounded'
import IconLanOutlineRounded from '~icons/material-symbols/lan-outline-rounded'
import IconAccountBalanceWalletOutlineRounded from '~icons/material-symbols/account-balance-wallet-outline-rounded'
import IconTerminalRounded from '~icons/material-symbols/terminal-rounded'
import { sitePermissionName } from '../../../shared/site-permission-names.js'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import type {
  ClaudeSetupDialogVariant,
  SavePasswordDialogVariant,
  SitePermissionDialogVariant,
  TrustedDialogRequest,
  TrustedDialogTopic,
  TrustedDialogType,
  WalletRecoveryDialogVariant
} from '../../../shared/trusted-dialogs.js'

type Translate = (key: MessageKey, parameters?: MessageParameters) => string

/** What a dialog asks, as the shell draws it. */
export interface TrustedDialogCopy {
  icon: Component
  /** Drives the icon's color: a question, or a warning that something was refused. */
  tone: 'question' | 'warning' | 'error' | 'info'
  eyebrow: string
  /** The headline, split around the website it names so that name can stand out; `emphasis` may be empty. */
  headline: { before: string, emphasis: string, after: string }
  description?: string
  /** A file path or other text the website chose, shown apart from Hronaut's words so it cannot pass for them. */
  quoted?: string
  /** What the quoted text is, such as the access asked for a file. */
  quotedLabel?: string
  /** A new wallet's recovery phrase, word by word, with the name its numbered list reads as. */
  phrase?: { label: string, words: string[] }
  /** A change to a file outside Hronaut, read as a diff: the file, the entry written and the one it replaces. */
  change?: {
    fileLabel: string
    path: string
    entries: Array<{ kind: 'added' | 'removed', label: string, text: string }>
  }
  /** Hronaut's own explanation, one paragraph each. */
  lines: string[]
  /** The line naming the workspace a choice is remembered in, shown with its own mark. */
  workspaceLine?: string
}

/** The headline message of each permission, by Chromium's name; any other permission uses `other`. */
const SITE_PERMISSION_ASKS: Readonly<Record<string, { key: MessageKey, icon: Component }>> = {
  geolocation: { key: 'trustedDialogs.sitePermission.wants.geolocation', icon: IconLocationOnOutlineRounded },
  notifications: { key: 'trustedDialogs.sitePermission.wants.notifications', icon: IconNotificationsOutlineRounded },
  'clipboard-read': { key: 'trustedDialogs.sitePermission.wants.clipboardRead', icon: IconContentPasteRounded },
  'clipboard-sanitized-write': { key: 'trustedDialogs.sitePermission.wants.clipboardWrite', icon: IconContentPasteRounded },
  midiSysex: { key: 'trustedDialogs.sitePermission.wants.midiSysex', icon: IconPianoOutlineRounded },
  fileSystem: { key: 'trustedDialogs.sitePermission.wants.fileSystem', icon: IconFolderOpenOutlineRounded },
  openExternal: { key: 'trustedDialogs.sitePermission.wants.openExternal', icon: IconOpenInNewRounded },
  fullscreen: { key: 'trustedDialogs.sitePermission.wants.fullscreen', icon: IconFullscreenRounded },
  'idle-detection': { key: 'trustedDialogs.sitePermission.wants.idleDetection', icon: IconDirectionsWalkRounded },
  keyboardLock: { key: 'trustedDialogs.sitePermission.wants.keyboardLock', icon: IconKeyboardOutlineRounded },
  pointerLock: { key: 'trustedDialogs.sitePermission.wants.pointerLock', icon: IconMouseOutlineRounded },
  'persistent-storage': { key: 'trustedDialogs.sitePermission.wants.persistentStorage', icon: IconDatabaseOutline },
  'screen-wake-lock': { key: 'trustedDialogs.sitePermission.wants.screenWakeLock', icon: IconLightModeOutlineRounded },
  'storage-access': { key: 'trustedDialogs.sitePermission.wants.storageAccess', icon: IconCookieOutlineRounded },
  'top-level-storage-access': { key: 'trustedDialogs.sitePermission.wants.topLevelStorageAccess', icon: IconCookieOutlineRounded },
  'window-management': { key: 'trustedDialogs.sitePermission.wants.windowManagement', icon: IconSelectWindowRounded },
  'display-capture': { key: 'trustedDialogs.sitePermission.wants.displayCapture', icon: IconScreenShareOutlineRounded }
}

const TYPE_ICONS: Readonly<Record<TrustedDialogType, Component>> = {
  none: IconInfoOutlineRounded,
  info: IconInfoOutlineRounded,
  question: IconHelpOutlineRounded,
  warning: IconWarningOutlineRounded,
  error: IconErrorOutlineRounded
}

/** The mark of a question about one of these, in place of its type's. */
const TOPIC_ICONS: Readonly<Record<TrustedDialogTopic, Component>> = {
  'unsaved-changes': IconEditNoteOutlineRounded,
  downloads: IconDownloadRounded,
  'browser-import': IconMoveToInboxOutlineRounded,
  passwords: IconKeyOutlineRounded,
  'agent-connection': IconLanOutlineRounded
}

/**
 * A message split around one of its parameters, `{origin}` unless named: an origin a website chooses, which must read
 * as a name, or another name the headline is about.
 */
function emphasized(
  t: Translate,
  key: MessageKey,
  value: string,
  parameters: MessageParameters = {},
  name = 'origin'
): TrustedDialogCopy['headline'] {
  const marker = '\u0000'
  const text = t(key, { ...parameters, [name]: marker })
  const at = text.indexOf(marker)
  if (at < 0) return { before: t(key, { ...parameters, [name]: value }), emphasis: '', after: '' }
  return { before: text.slice(0, at), emphasis: value, after: text.slice(at + marker.length) }
}

/** What a site permission request asks for, and its mark: a camera-only request names the camera, not both devices. */
export function sitePermissionAsk(variant: Pick<SitePermissionDialogVariant, 'permission' | 'mediaTypes'>): { key: MessageKey, icon: Component } {
  if (variant.permission === 'media') {
    const types = variant.mediaTypes ?? []
    if (types.length > 0 && types.every((type) => type === 'video')) return { key: 'trustedDialogs.sitePermission.wants.camera', icon: IconVideocamOutlineRounded }
    if (types.length > 0 && types.every((type) => type === 'audio')) return { key: 'trustedDialogs.sitePermission.wants.microphone', icon: IconMicOutlineRounded }
    return { key: 'trustedDialogs.sitePermission.wants.cameraAndMicrophone', icon: IconVideocamRounded }
  }
  return Object.hasOwn(SITE_PERMISSION_ASKS, variant.permission)
    ? SITE_PERMISSION_ASKS[variant.permission]!
    : { key: 'trustedDialogs.sitePermission.wants.other', icon: IconShieldQuestionOutlineRounded }
}

function sitePermissionCopy(variant: SitePermissionDialogVariant, t: Translate): TrustedDialogCopy {
  const ask = sitePermissionAsk(variant)
  const { workspaceName: workspace, embeddedIn } = variant
  const lines: string[] = []
  let quoted: string | undefined
  let quotedLabel: string | undefined
  if (variant.file) {
    const access = t(variant.file.access === 'readable' ? 'native.dialog.fileReadAccess'
      : variant.file.access === 'writable' ? 'native.dialog.fileWriteAccess' : 'native.dialog.unspecifiedAccess')
    quoted = variant.file.path || t('native.dialog.unspecifiedPath')
    quotedLabel = access.charAt(0).toLocaleUpperCase() + access.slice(1)
    if (variant.file.access === 'readable') lines.push(t('native.dialog.fileReadKeeps'))
    if (variant.file.access === 'writable') lines.push(t('native.dialog.fileWriteUntilReload'))
  }
  if (variant.externalScheme) lines.push(t('native.dialog.requestedExternalApp', { scheme: variant.externalScheme }))
  let workspaceLine: string | undefined
  if (variant.freshConsent) {
    if (workspace) workspaceLine = t('native.dialog.permissionAskedIn', { detail: '', workspace }).trim()
    lines.push(t('native.dialog.permissionAskAgain', { detail: '' }).trim())
  } else {
    workspaceLine = embeddedIn
      ? workspace
        ? t('native.dialog.permissionRememberEmbeddedIn', { site: embeddedIn, workspace })
        : t('native.dialog.permissionRememberEmbedded', { site: embeddedIn })
      : workspace ? t('native.dialog.permissionRememberIn', { workspace }) : t('native.dialog.permissionRemember')
    lines.push(t('native.dialog.permissionSettings', { detail: '' }).trim())
  }
  return {
    icon: ask.icon,
    tone: 'question',
    eyebrow: t('native.dialog.sitePermission'),
    headline: emphasized(t, ask.key, variant.origin, { permission: sitePermissionName(variant.permission, t) }),
    ...(embeddedIn ? { description: t('trustedDialogs.sitePermission.embeddedIn', { site: embeddedIn }) } : {}),
    ...(quoted ? { quoted, quotedLabel } : {}),
    lines,
    ...(workspaceLine ? { workspaceLine } : {})
  }
}

/** Offers to keep a password a page submitted: the website stands out, and the username, which the page sent, is quoted. */
function savePasswordCopy(variant: SavePasswordDialogVariant, t: Translate): TrustedDialogCopy {
  return {
    icon: IconKeyOutlineRounded,
    tone: 'question',
    eyebrow: t('trustedDialogs.savePassword.eyebrow'),
    headline: emphasized(t, variant.updating ? 'trustedDialogs.savePassword.update' : 'trustedDialogs.savePassword.save', variant.origin),
    ...(variant.username ? { quoted: variant.username, quotedLabel: t('trustedDialogs.savePassword.username') } : {}),
    lines: [
      ...(variant.username ? [] : [t('trustedDialogs.savePassword.noUsername')]),
      t('trustedDialogs.savePassword.stored')
    ]
  }
}

/** Shows a new wallet's recovery phrase as a numbered list of its words, with what keeping it means. */
function walletRecoveryCopy(variant: WalletRecoveryDialogVariant, t: Translate): TrustedDialogCopy {
  return {
    icon: IconAccountBalanceWalletOutlineRounded,
    tone: 'warning',
    eyebrow: t('trustedDialogs.walletRecovery.eyebrow'),
    headline: emphasized(t, 'trustedDialogs.walletRecovery.headline', variant.walletName, {}, 'wallet'),
    phrase: { label: t('trustedDialogs.walletRecovery.phrase'), words: [...variant.words] },
    lines: [
      t('trustedDialogs.walletRecovery.keep'),
      t('native.dialog.walletRecoveryWarning'),
      t('trustedDialogs.walletRecovery.added')
    ]
  }
}

/** Shows the exact change to Claude Code's settings that Home showed, before Hronaut writes it. */
function claudeSetupCopy(variant: ClaudeSetupDialogVariant, t: Translate): TrustedDialogCopy {
  return {
    icon: IconTerminalRounded,
    tone: 'question',
    eyebrow: t('native.dialog.claudeSetupTitle'),
    headline: { before: t('native.dialog.claudeSetupMessage'), emphasis: '', after: '' },
    change: {
      fileLabel: t('trustedDialogs.claudeSetup.file'),
      path: variant.path,
      entries: [
        { kind: 'added', label: t('trustedDialogs.claudeSetup.added'), text: `"hronaut": ${variant.after}` },
        ...(variant.before === null ? [] : [{ kind: 'removed' as const, label: t('trustedDialogs.claudeSetup.replaces'), text: `"hronaut": ${variant.before}` }])
      ]
    },
    lines: [
      ...(variant.tokenHidden ? [t('home.connect.claudeSetup.previewToken')] : []),
      t('home.connect.claudeSetup.previewBackup', { name: variant.backupName }),
      t('home.connect.claudeSetup.previewQuit')
    ]
  }
}

/** The words and mark of a dialog: its own design for a known variant, or its message and detail as given. */
export function trustedDialogCopy(request: TrustedDialogRequest, t: Translate): TrustedDialogCopy {
  const { variant } = request
  if (variant.kind === 'site-permission') return sitePermissionCopy(variant, t)
  if (variant.kind === 'save-password') return savePasswordCopy(variant, t)
  if (variant.kind === 'wallet-recovery') return walletRecoveryCopy(variant, t)
  if (variant.kind === 'claude-setup') return claudeSetupCopy(variant, t)
  if (variant.kind === 'protected-file-access') {
    const folder = variant.target === 'folder'
    return {
      icon: IconGppMaybeOutlineRounded,
      tone: 'warning',
      eyebrow: t('native.dialog.sitePermission'),
      headline: emphasized(t, folder ? 'native.dialog.protectedFolder' : 'native.dialog.protectedFile', variant.origin),
      lines: [t(folder ? 'native.dialog.protectedFolderDetail' : 'native.dialog.protectedFileDetail')]
    }
  }
  const { topic } = variant
  return {
    icon: topic && Object.hasOwn(TOPIC_ICONS, topic) ? TOPIC_ICONS[topic] : TYPE_ICONS[request.type],
    tone: request.type === 'warning' || request.type === 'error' ? request.type : request.type === 'question' ? 'question' : 'info',
    eyebrow: request.title ?? '',
    headline: { before: request.message, emphasis: '', after: '' },
    lines: (request.detail ?? '').split(/\n{2,}/u).map((line) => line.trim()).filter(Boolean)
  }
}
