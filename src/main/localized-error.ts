import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { translate, type MessageKey, type MessageParameters } from '../shared/i18n.js'

/**
 * A failure a person can see, named by its message key. Its message is the English text, which MCP results, logs and
 * the code that compares messages keep reading; Hronaut's own pages get the interface language instead. Its name stays
 * "Error", because only `toString()` crosses IPC and the renderer strips that "Error: " prefix.
 */
export class LocalizedError extends Error {
  readonly key: MessageKey
  readonly parameters: MessageParameters | undefined

  constructor(key: MessageKey, parameters?: MessageParameters) {
    super(translate('en-US', key, parameters))
    this.key = key
    this.parameters = parameters
  }
}

/** The message for a person: a LocalizedError in the interface language, any other error's own message. */
export function personErrorMessage(error: unknown, text: (key: MessageKey, parameters?: MessageParameters) => string): string {
  if (error instanceof LocalizedError) return text(error.key, error.parameters)
  return error instanceof Error ? error.message : String(error ?? '')
}

interface TranslatedIpcErrorsHost {
  /** Whether a message came from one of Hronaut's own pages. Websites keep the English, which does not tell them the language. */
  isHronautPage(event: IpcMainInvokeEvent): boolean
  text(key: MessageKey, parameters?: MessageParameters): string
}

/**
 * The ipcMain Hronaut's handlers register on. A LocalizedError a handler throws reaches Hronaut's own pages in the
 * interface language; only an error's message crosses IPC, so the translated error replaces it. Every other error,
 * and every error for a website, passes through unchanged.
 */
export function withTranslatedIpcErrors(
  ipcMain: Pick<IpcMain, 'handle' | 'on'>,
  host: TranslatedIpcErrorsHost
): Pick<IpcMain, 'handle' | 'on'> {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, async (event, ...args: unknown[]) => {
        try {
          return await listener(event, ...args)
        } catch (error) {
          if (error instanceof LocalizedError && host.isHronautPage(event)) throw new Error(host.text(error.key, error.parameters))
          throw error
        }
      })
    },
    on(channel, listener) {
      return ipcMain.on(channel, listener)
    }
  }
}
