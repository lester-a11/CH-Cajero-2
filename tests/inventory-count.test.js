import test from 'node:test';
import assert from 'node:assert/strict';
import { selectInventoryRecountRows, recountResult, recountProgressLabel } from '../src/app/inventory-count.js';

const rows = (mismatchIndexes, total = 10) => Array.from({ length: total }, (_, index) => ({
  id: `row-${index + 1}`,
  esperado_al_contar: 5,
  conteo_1: mismatchIndexes.includes(index) ? 4 : 5
}));

test('si el primer conteo no tiene diferencias, no pide reconteos de muestra', () => {
  const result = selectInventoryRecountRows(rows([]), () => 0);
  assert.equal(result.mismatches.length, 0);
  assert.equal(result.selected.length, 0);
});

test('si hay diferencias, incluye todos los errores y un 20% adicional de coincidencias', () => {
  const result = selectInventoryRecountRows(rows([0], 11), () => 0.5);
  assert.deepEqual(result.mismatches.map(row => row.id), ['row-1']);
  assert.equal(result.matching.length, 10);
  assert.equal(result.selected.length, 3); // 1 discrepante + ceil(10 * 20%)
  assert.equal(result.selected[0].id, 'row-1');
  assert.equal(new Set(result.selected.map(row => row.id)).size, 3);
});

test('si todos discrepan, el reconteo incluye todos y no agrega muestras', () => {
  const result = selectInventoryRecountRows(rows([0, 1, 2, 3], 4), () => 0);
  assert.equal(result.selected.length, 4);
});

test('dos lecturas iguales al esperado confirman el conteo', () => {
  assert.equal(recountResult(12, 12, 12), 'coincide');
});

test('dos lecturas distintas siempre requieren revisión como inconsistentes', () => {
  assert.equal(recountResult(12, 11, 12), 'inconsistente');
});

test('dos lecturas iguales pero distintas del esperado quedan pendientes de revisión', () => {
  assert.equal(recountResult(12, 10, 10), 'pendiente_verificar');
});


test('el indicador del dependiente no revela cantidades durante el reconteo', () => {
  assert.equal(recountProgressLabel({ conteo_1: 8, conteo_2: null }), 'Pendiente de reconteo');
  assert.equal(recountProgressLabel({ conteo_1: 8, conteo_2: 9 }), 'Reconteo registrado');
});
