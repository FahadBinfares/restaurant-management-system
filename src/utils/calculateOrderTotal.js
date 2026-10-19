export default function calculateOrderTotal(items) {
  const calculator = items.reduce((acc, item) => {
    return acc + item.quantity * item.unitPrice;
  }, 0);

  return calculator;
}
