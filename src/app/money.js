export const roundMoney = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
export const formatUSD = value => `$${roundMoney(value).toFixed(2)}`;
export const formatCUP = value => `${roundMoney(value).toFixed(2)} CUP`;

export function paymentCredit(method, amount, rate, surchargePercent = 20) {
  const raw = Number(amount);
  const exchange = Number(rate);
  if (!Number.isFinite(raw) || raw < 0) throw new Error('El monto del pago no es válido.');
  if (!Number.isFinite(exchange) || exchange <= 0) throw new Error('La tasa CUP/USD no es válida.');
  if (method === 'USD') return roundMoney(raw);
  if (method === 'CUP') return roundMoney(raw / exchange);
  if (method === 'TRANSFER') return roundMoney((raw / (1 + Number(surchargePercent) / 100)) / exchange);
  throw new Error('Método de pago desconocido.');
}

export function recommendedAmount(method, pendingUsd, rate, surchargePercent = 20) {
  const pending = Math.max(0, Number(pendingUsd));
  if (method === 'USD') return roundMoney(pending);
  if (method === 'CUP') return roundMoney(pending * Number(rate));
  if (method === 'TRANSFER') return roundMoney(pending * Number(rate) * (1 + Number(surchargePercent) / 100));
  throw new Error('Método de pago desconocido.');
}

export function calculateBalance(totalUsd, paymentsUsd) {
  return roundMoney(Number(totalUsd) - Number(paymentsUsd));
}

export function calculateChange(totalUsd, paymentsUsd) {
  return Math.max(0, roundMoney(Number(paymentsUsd) - Number(totalUsd)));
}

export function cashChange(changeUsd, currency, rate) {
  if (currency === 'CUP') return { currency: 'CUP', amount: roundMoney(Number(changeUsd) * Number(rate)) };
  return { currency: 'USD', amount: roundMoney(changeUsd) };
}

export function calculateDrawerBalances(payments, changes) {
  const sum = values => roundMoney(values.reduce((total, value) => total + Number(value || 0), 0));
  const usdReceived = sum(payments.filter(payment => payment.metodo === 'USD').map(payment => payment.monto));
  const cupReceived = sum(payments.filter(payment => payment.metodo === 'CUP').map(payment => payment.monto));
  const transfers = sum(payments.filter(payment => payment.metodo === 'TRANSFER').map(payment => payment.monto));
  const usdChange = sum(changes.filter(change => change?.moneda === 'USD').map(change => change.monto));
  const cupChange = sum(changes.filter(change => change?.moneda === 'CUP').map(change => change.monto));
  return {
    efectivo_usd_esperado: roundMoney(usdReceived - usdChange),
    efectivo_cup_esperado: roundMoney(cupReceived - cupChange),
    transferencias: transfers
  };
}
