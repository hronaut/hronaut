import { pageScript } from '../../shared/page-script.js'
import { passwordOccupancySettlementInPage } from './password-occupancy.page.js'

export function passwordOccupancySettlementScript(token: string, cancel = false): string {
  return pageScript(passwordOccupancySettlementInPage, token, cancel)
}
