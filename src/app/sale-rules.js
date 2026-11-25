import { roundMoney, paymentCredit, cashChange, calculateBalance, calculateChange } from './money.js';

/** Resumen monetario de una venta a partir de sus pagos persistidos. */
export function summarizeSale(totalUsd, payments = []) {
  const total = roundMoney(totalUsd);
  const activePayments = payments.filter(payment => (payment.estado || 'activo') === 'activo');
  const paid = roundMoney(activePayments.reduce((sum, payment) => sum + Number(payment.equivalente_usd || 0), 0));
  const balance = calculateBalance(total, paid);
  const change = calculateChange(total, paid);
  return { total, paid, balance, change, isPaid: balance <= 0, activePayments };
}

/** Normaliza y prepara un pago conforme al método y a la tasa guardada en la venta. */
export function buildPaymentRecord({ method, amount, rate, surchargePercent = 20, dateTime }) {
  const original = roundMoney(amount);
  if (!Number.isFinite(original) || original <= 0) {
    throw new Error('Introduce un monto mayor que cero.');
  }
  if (!['USD', 'CUP', 'TRANSFER'].includes(method)) {
    throw new Error('Método de pago desconocido.');
  }
  const exchangeRate = Number(rate);
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new Error('La tasa CUP/USD no es válida.');
  }
  const surcharge = Number(surchargePercent);
  if (!Number.isFinite(surcharge) || surcharge < 0 || surcharge > 100) {
    throw new Error('El recargo de transferencia debe estar entre 0 y 100%.');
  }
  return {
    metodo: method,
    monto_original: original,
    moneda: method === 'USD' ? 'USD' : 'CUP',
    tasa_aplicada: method === 'USD' ? 1 : exchangeRate,
    equivalente_usd: paymentCredit(method, original, exchangeRate, surcharge),
    fecha_hora: dateTime
  };
}

/** Calcula el vuelto que se entrega en efectivo USD o CUP. */
export function buildChangeRecord(changeUsd, currency, rate) {
  const amountUsd = roundMoney(changeUsd);
  if (amountUsd <= 0) return { moneda: null, monto: 0 };
  if (!['USD', 'CUP'].includes(currency)) throw new Error('La moneda del vuelto debe ser USD o CUP.');
  const result = cashChange(amountUsd, currency, rate);
  return { moneda: result.currency, monto: result.amount };
}

/** Solo las unidades no anuladas de una venta cerrada se reponen al anularla. */
export function stockToRestore(saleStatus, lines = []) {
  if (saleStatus !== 'cerrada') return [];
  return lines
    .filter(line => !Number(line.anulada) && Number(line.cantidad) > 0)
    .map(line => ({ codigo: String(line.codigo), cantidad: Number(line.cantidad) }));
}

/** Las líneas anuladas no se descuentan del inventario al finalizar una venta. */
export function stockToDeduct(lines = []) {
  return lines
    .filter(line => !Number(line.anulada) && Number(line.cantidad) > 0)
    .map(line => ({ codigo: String(line.codigo), cantidad: Number(line.cantidad) }));
}

export function saleCanClose(totalUsd, payments = []) {
  return summarizeSale(totalUsd, payments).isPaid;
}

/** Solo ventas no finalizadas pueden cancelarse por el dependiente. */
export function saleCanBeCancelled(status) {
  return ['abierta', 'pausada'].includes(String(status));
}

/** La anulación administrativa con reposición de inventario es exclusiva de ventas cerradas. */
export function saleCanBeAnnulled(status) {
  return String(status) === 'cerrada';
}
