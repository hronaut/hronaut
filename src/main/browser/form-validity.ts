import { pageScript } from '../../shared/page-script.js'
import { formValiditySettlementInPage } from './form-validity.page.js'

// Both entry points accept only the internal randomUUID handle, never page input.
export function formValidityToken(token: string): string {
  if (typeof token !== 'string' || token.length !== 36
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(token)) {
    throw new TypeError('Invalid form validity inspection token')
  }
  return token
}

export function formValiditySettlementScript(token: string, cancel = false): string {
  return pageScript(formValiditySettlementInPage, formValidityToken(token), cancel)
}
