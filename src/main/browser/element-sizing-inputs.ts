import { pageScript } from '../../shared/page-script.js'
import { sizingInputsSettlementInPage } from './element-sizing-inputs.page.js'

export function sizingInputsSettlementScript(token: string, cancel = false): string {
  return pageScript(sizingInputsSettlementInPage, token, cancel)
}
