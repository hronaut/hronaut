import { enUSAppErrors } from './en-US.js'
import { ukUAAppErrors } from './uk-UA.js'
import { ruRUAppErrors } from './ru-RU.js'
import { deDEAppErrors } from './de-DE.js'
import { frFRAppErrors } from './fr-FR.js'
import { esESAppErrors } from './es-ES.js'
import { plPLAppErrors } from './pl-PL.js'
import { itITAppErrors } from './it-IT.js'
import { ptBRAppErrors } from './pt-BR.js'
import { trTRAppErrors } from './tr-TR.js'
import { hiINAppErrors } from './hi-IN.js'
import { jaJPAppErrors } from './ja-JP.js'
import { koKRAppErrors } from './ko-KR.js'
import { zhCNAppErrors } from './zh-CN.js'
import { zhTWAppErrors } from './zh-TW.js'

/** Errors from the main process that a person sees, one file for each language. */
export const appErrorMessages = {
  'en-US': enUSAppErrors,
  'uk-UA': ukUAAppErrors,
  'ru-RU': ruRUAppErrors,
  'de-DE': deDEAppErrors,
  'fr-FR': frFRAppErrors,
  'es-ES': esESAppErrors,
  'pl-PL': plPLAppErrors,
  'it-IT': itITAppErrors,
  'pt-BR': ptBRAppErrors,
  'tr-TR': trTRAppErrors,
  'hi-IN': hiINAppErrors,
  'ja-JP': jaJPAppErrors,
  'ko-KR': koKRAppErrors,
  'zh-CN': zhCNAppErrors,
  'zh-TW': zhTWAppErrors
}
