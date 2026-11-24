// The sales period starts at midnight in Paris, while France is still on summer time.
export const salesStart = '2026-09-30T22:00:00.000Z'
export const salesPeriodLabel = 'Depuis le 1er octobre 2026'
const cutoff = Date.parse(salesStart)
export const inSalesPeriod = value => Date.parse(value) >= cutoff

// Scalency orders are requested newest first by order_date. Stop at the first page
// spanning the cutoff, keeping every eligible row on that page.
export function restrictOrderPage(page) {
  const data = page.data.filter(order => inSalesPeriod(order.order_date))
  const exhausted = page.data.some(order => Date.parse(order.order_date) < cutoff)
  return {...page, data, has_more: !exhausted && page.has_more, next_cursor: exhausted ? null : page.next_cursor}
}
