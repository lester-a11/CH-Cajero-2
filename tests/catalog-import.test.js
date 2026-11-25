import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalogImportPlan, buildSingleProductImportPlan, applyableRows } from '../src/app/catalog-import.js';

const existing = [{ codigo:'A-01', nombre:'Viejo', precio_usd:1, stock:7 }];

test('catálogo crea y actualiza por código sin duplicar', () => {
  const plan = buildCatalogImportPlan({ tipo:'catalogo', version:1, productos:[
    { codigo:'A-01', nombre:'Actualizado', precio_usd:2.5, stock:99 },
    { codigo:'B-02', nombre:'Nuevo', precio_usd:3, stock:4 }
  ]}, existing);
  assert.equal(plan.created, 1);
  assert.equal(plan.updated, 1);
  assert.equal(plan.errors, 0);
  assert.equal(applyableRows(plan).length, 2);
  assert.equal(plan.inventoryCorrected, false);
});

test('el stock existente solo puede reemplazarse con inventario_corregido', () => {
  const plan = buildCatalogImportPlan({ tipo:'catalogo', version:1, inventario_corregido:true,
    productos:[{ codigo:'A-01', nombre:'A', precio_usd:2, stock:12 }] }, existing);
  assert.equal(plan.inventoryCorrected, true);
  assert.equal(plan.rows[0].current.stock, 7);
  assert.equal(plan.rows[0].product.stock, 12);
});

test('rechaza rutas de foto inseguras, fotos ausentes y códigos repetidos', () => {
  const plan = buildCatalogImportPlan({ tipo:'catalogo', version:1, productos:[
    { codigo:'X', nombre:'X', precio_usd:1, stock:1, foto:'../secret.jpg' },
    { codigo:'Y', nombre:'Y', precio_usd:1, stock:1 },
    { codigo:'Y', nombre:'Duplicado', precio_usd:1, stock:1 },
    { codigo:'Z', nombre:'Foto ausente', precio_usd:1, stock:1, foto:'fotos/no.jpg' }
  ]}, [], []);
  assert.equal(plan.errors, 3);
  assert.equal(plan.applicable, 1);
});

test('producto individual solo agrega códigos nuevos', () => {
  const good = buildSingleProductImportPlan({ tipo:'producto', version:1,
    producto:{ codigo:'B', nombre:'B', precio_usd:1.25, stock:2 } }, existing);
  const duplicate = buildSingleProductImportPlan({ tipo:'producto', version:1,
    producto:{ codigo:'A-01', nombre:'A', precio_usd:1, stock:2 } }, existing);
  assert.equal(good.created, 1);
  assert.equal(duplicate.errors, 1);
});
