import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDayClosure } from '../src/app/closure.js';

test('resumen de cierre separa ventas cerradas y anuladas y calcula métodos', () => {
  const result = summarizeDayClosure([
    { estado:'cerrada', total_usd:10, pagos:[
      { metodo:'USD', moneda:'USD', monto_original:4, equiv_usd:4 },
      { metodo:'CUP', moneda:'CUP', monto_original:1000, equiv_usd:2 },
      { metodo:'TRANSFER', moneda:'CUP', monto_original:2400, equiv_usd:4 }
    ], vuelto:{ moneda:'USD', monto:1 } },
    { estado:'anulada', total_usd:5, pagos:[{ metodo:'USD', moneda:'USD', monto_original:5, equiv_usd:5 }] }
  ]);
  assert.equal(result.n_ventas, 1);
  assert.equal(result.total_usd, 10);
  assert.equal(result.anulaciones, 1);
  assert.equal(result.efectivo_usd_esperado, 3);
  assert.equal(result.efectivo_cup_esperado, 1000);
  assert.equal(result.transferencias, 2400);
});

test('resumen vacío no inventa importes', () => {
  const result = summarizeDayClosure([]);
  assert.equal(result.n_ventas, 0);
  assert.equal(result.total_usd, 0);
  assert.equal(result.efectivo_usd_esperado, 0);
});
