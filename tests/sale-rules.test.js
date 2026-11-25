import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentRecord, buildChangeRecord, saleCanClose, saleCanBeCancelled, saleCanBeAnnulled, stockToRestore, stockToDeduct, summarizeSale } from '../src/app/sale-rules.js';

const at = '2026-11-19T12:00:00.000Z';

test('cobro mixto USD + CUP + transferencia completa el saldo sin recargo al efectivo', () => {
  const usd = buildPaymentRecord({ method: 'USD', amount: 3, rate: 500, dateTime: at });
  const cup = buildPaymentRecord({ method: 'CUP', amount: 200, rate: 500, dateTime: at });
  const transferAmount = 3960; // 6.60 USD × 500 CUP × 1.20
  const transfer = buildPaymentRecord({ method: 'TRANSFER', amount: transferAmount, rate: 500, surchargePercent: 20, dateTime: at });
  const summary = summarizeSale(10, [usd, cup, transfer]);
  assert.equal(usd.equivalente_usd, 3);
  assert.equal(cup.equivalente_usd, 0.4);
  assert.equal(transfer.equivalente_usd, 6.6);
  assert.equal(summary.paid, 10);
  assert.equal(summary.balance, 0);
  assert.equal(summary.isPaid, true);
  assert.equal(transfer.moneda, 'CUP');
  assert.equal(transfer.tasa_aplicada, 500);
});

test('la fórmula fijada para transferencia: 600 CUP cubren 1 USD nominal a tasa 500', () => {
  const payment = buildPaymentRecord({ method: 'TRANSFER', amount: 600, rate: 500, surchargePercent: 20, dateTime: at });
  assert.equal(payment.equivalente_usd, 1);
});

test('redondea el importe original del pago a dos decimales antes de persistirlo', () => {
  const payment = buildPaymentRecord({ method: 'USD', amount: 2.555, rate: 500, dateTime: at });
  assert.equal(payment.monto_original, 2.56);
  assert.equal(payment.equivalente_usd, 2.56);
});

test('no permite cerrar mientras el saldo sea positivo', () => {
  assert.equal(saleCanClose(10, [{ equivalente_usd: 9.99 }]), false);
  assert.equal(saleCanClose(10, [{ equivalente_usd: 10 }]), true);
  assert.equal(saleCanClose(0, []), true);
});

test('calcula vuelto en ambas monedas a la tasa de la venta', () => {
  assert.deepEqual(buildChangeRecord(2.5, 'USD', 500), { moneda: 'USD', monto: 2.5 });
  assert.deepEqual(buildChangeRecord(2.5, 'CUP', 500), { moneda: 'CUP', monto: 1250 });
  assert.deepEqual(buildChangeRecord(0, 'USD', 500), { moneda: null, monto: 0 });
});

test('al anular una venta cerrada repone solo líneas no anuladas previamente', () => {
  const lines = [
    { codigo: 'A', cantidad: 2, anulada: 0 },
    { codigo: 'B', cantidad: 3, anulada: 1 },
    { codigo: 'C', cantidad: 1, anulada: 0 }
  ];
  assert.deepEqual(stockToRestore('cerrada', lines), [
    { codigo: 'A', cantidad: 2 },
    { codigo: 'C', cantidad: 1 }
  ]);
  assert.deepEqual(stockToRestore('pausada', lines), []);
});

test('la finalización descuenta solo líneas activas', () => {
  assert.deepEqual(stockToDeduct([
    { codigo: 'A', cantidad: 2, anulada: 0 },
    { codigo: 'B', cantidad: 4, anulada: 1 }
  ]), [{ codigo: 'A', cantidad: 2 }]);
});

test('los pagos anulados dejan de contar al recalcular el saldo', () => {
  const summary = summarizeSale(10, [
    { equivalente_usd: 6, estado: 'activo' },
    { equivalente_usd: 4, estado: 'anulado' }
  ]);
  assert.equal(summary.paid, 6);
  assert.equal(summary.balance, 4);
  assert.equal(summary.activePayments.length, 1);
});

test('cancelar ventas abiertas/pausadas y anular administrativamente solo ventas cerradas', () => {
  assert.equal(saleCanBeCancelled('abierta'), true);
  assert.equal(saleCanBeCancelled('pausada'), true);
  assert.equal(saleCanBeCancelled('cerrada'), false);
  assert.equal(saleCanBeAnnulled('cerrada'), true);
  assert.equal(saleCanBeAnnulled('cancelada'), false);
  assert.equal(saleCanBeAnnulled('abierta'), false);
});
