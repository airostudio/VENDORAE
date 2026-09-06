/**
 * Where to view a placed order on AliExpress.
 *
 * The order lives in whichever AliExpress account the dropship engine placed it under, so this
 * link only resolves for someone signed into that account — it is a shortcut for the operator,
 * not something to show a customer.
 */
export function aliexpressOrderUrl(aliexpressOrderId: string): string {
  return `https://trade.aliexpress.com/order_detail.htm?orderId=${encodeURIComponent(aliexpressOrderId)}`;
}
