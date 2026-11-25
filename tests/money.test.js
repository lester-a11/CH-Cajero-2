import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentCredit, recommendedAmount, calculateBalance, calculateChange, cashChange, calculateDrawerBalances } from '../src/app/money.js';

test('efectivo USD se acredita sin conversión', () => {
  assert.equal(paymentCredit('USD', 12.5, 500), 12.5);
});

test('efectivo CUP se convierte a USD sin recargo', () => {
  assert.equal(paymentCredit('CUP', 500, 500), 1);
});

test('transferencia aplica el 20% sobre CUP y devuelve equivalente nominal', () => {
  assert.equal(paymentCredit('TRANSFER', 600, 500, 20), 1);
  assert.equal(recommendedAmount('TRANSFER', 1, 500, 20), 600);
});

test('cobro mixto calcula saldo y vuelto', () => {
  const paid = paymentCredit('USD', 2, 500) + paymentCredit('CUP', 500, 500);
  assert.equal(calculateBalance(4, paid), 1);
  assert.equal(calculateChange(3, paid), 0);
  assert.deepEqual(cashChange(1.25, 'CUP', 500), { currency: 'CUP', amount: 625 });
});

test('rechaza tasa o monto inválido', () => {
  assert.throws(() => paymentCredit('CUP', 300, 0));
  assert.throws(() => paymentCredit('USD', -1, 500));
});

test('el cierre descuenta el vuelto de la gaveta de la moneda entregada', () => {
  const result = calculateDrawerBalances([
    { metodo: 'USD', monto: 10 },
    { metodo: 'CUP', monto: 1000 },
    { metodo: 'TRANSFER', monto: 600 }
  ], [
    { moneda: 'USD', monto: 2 },
    { moneda: 'CUP', monto: 500 }
  ]);
  assert.deepEqual(result, { efectivo_usd_esperado: 8, efectivo_cup_esperado: 500, transferencias: 600 });
});
