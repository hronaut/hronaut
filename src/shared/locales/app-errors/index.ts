import { enUSAppErrors } from './en-US.js'
import { ukUAAppErrors } from './uk-UA.js'
import { ruRUAppErrors } from './ru-RU.js'
import { deDEAppErrors } from './de-DE.js'
import { frFRAppErrors } from './fr-FR.js'
import { esESAppErrors } from './es-ES.js'
import { plPLAppErrors } from './pl-PL.js'

/** Errors from the main process that a person sees, one file for each language. */
export const appErrorMessages = {
  'en-US': enUSAppErrors,
  'uk-UA': ukUAAppErrors,
  'ru-RU': ruRUAppErrors,
  'de-DE': deDEAppErrors,
  'fr-FR': frFRAppErrors,
  'es-ES': esESAppErrors,
  'pl-PL': plPLAppErrors
}
