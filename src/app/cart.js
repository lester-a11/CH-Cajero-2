import { roundMoney } from './money.js';

export function calculateLineSubtotal(line) {
  return roundMoney(Number(line?.precio_snapshot ?? line?.precio_usd ?? 0) * Number(line?.cantidad ?? 0));
}

export function calculateCartTotal(lines = []) {
  const total = lines
    .filter(line => !Number(line.anulada))
    .reduce((sum, line) => sum + calculateLineSubtotal(line), 0);
  return roundMoney(total);
}
