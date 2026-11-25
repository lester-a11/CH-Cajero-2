import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateCartTotal, calculateLineSubtotal } from '../src/app/cart.js';

test('el catálogo de aceptación suma 1 + 2 + 3 = 6 USD', () => {
  const lines = [
    { precio_snapshot: 1, cantidad: 1 },
    { precio_snapshot: 2, cantidad: 1 },
    { precio_snapshot: 3, cantidad: 1 }
  ];
  assert.equal(calculateCartTotal(lines), 6);
});

test('acumular unidades de la misma línea calcula el subtotal', () => {
  assert.equal(calculateLineSubtotal({ precio_snapshot: 1.25, cantidad: 3 }), 3.75);
  assert.equal(calculateCartTotal([{ precio_snapshot: 1.25, cantidad: 3 }]), 3.75);
});

test('las líneas anuladas no forman parte del total', () => {
  assert.equal(calculateCartTotal([
    { precio_snapshot: 2, cantidad: 1, anulada: 0 },
    { precio_snapshot: 9, cantidad: 1, anulada: 1 }
  ]), 2);
});
