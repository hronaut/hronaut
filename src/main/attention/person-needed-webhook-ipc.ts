import { app, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import type { TypedIpcMain } from '../typed-ipc.js'
import { SETTINGS_IPC } from '../../shared/ipc/settings.js'
import { createPersonNeededWebhook, type PersonNeededWebhook } from './person-needed-webhook.js'

let webhook: PersonNeededWebhook | undefined

/** This profile's webhook, its settings in a file of the profile only its user can read. */
export function personNeededWebhook(): PersonNeededWebhook {
  webhook ??= createPersonNeededWebhook({
    path: join(app.getPath('userData'), 'person-needed-webhook.json'),
    userAgent: `Hronaut/${app.getVersion()}`,
    log: message => console.warn(message)
  })
  return webhook
}

/** Settings' Message me elsewhere: reads and changes the webhook, and sends a test message, for the trusted shell only. */
export function registerPersonNeededWebhookIpc(ipcMain: Pick<TypedIpcMain, 'handle'>, assertTrustedSender: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle(SETTINGS_IPC.getPersonNeededWebhook, async (event) => {
    assertTrustedSender(event)
    return personNeededWebhook().settings()
  })
  ipcMain.handle(SETTINGS_IPC.setPersonNeededWebhook, async (event, config: unknown) => {
    assertTrustedSender(event)
    return personNeededWebhook().configure(config as never)
  })
  ipcMain.handle(SETTINGS_IPC.renewPersonNeededWebhookSecret, async (event) => {
    assertTrustedSender(event)
    return personNeededWebhook().renewSecret()
  })
  ipcMain.handle(SETTINGS_IPC.testPersonNeededWebhook, async (event) => {
    assertTrustedSender(event)
    return personNeededWebhook().test()
  })
}
