export interface OrderTotalLineItem {
  readonly quantity: number;
  readonly unitPrice: number;
}

export default function calculateOrderTotal(
  items: readonly OrderTotalLineItem[],
): number {
  const calculator = items.reduce((acc, item) => {
    return acc + item.quantity * item.unitPrice;
  }, 0);

  return calculator;
}
