import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_TABLE_COLUMNS, validateBackupPayload } from '../src/app/backup-validation.js';

function validPayload() {
  return { tipo:'respaldo_cajero', version:2,
    data:Object.fromEntries(Object.entries(BACKUP_TABLE_COLUMNS).map(([table, columns]) => [table, []])) };
}

test('acepta respaldo con todas las tablas y columnas esperadas', () => {
  const result = validateBackupPayload(validPayload());
  assert.equal(result.valid, true);
  assert.equal(Object.keys(result.rowCounts).length, Object.keys(BACKUP_TABLE_COLUMNS).length);
});

test('rechaza tablas, columnas y tablas faltantes', () => {
  const extraTable = validPayload(); extraTable.data.secrets = [];
  assert.equal(validateBackupPayload(extraTable).valid, false);
  const extraColumn = validPayload(); extraColumn.data.productos.push({ ...Object.fromEntries(BACKUP_TABLE_COLUMNS.productos.map(c => [c, null])), password:'x' });
  assert.match(validateBackupPayload(extraColumn).reason, /Columna no permitida/);
  const missing = validPayload(); delete missing.data.pagos;
  assert.match(validateBackupPayload(missing).reason, /Falta la tabla pagos/);
});

test('rechaza registros que no son objetos o carecen de columnas', () => {
  const malformed = validPayload(); malformed.data.usuarios.push('mal');
  assert.equal(validateBackupPayload(malformed).valid, false);
  const incomplete = validPayload(); incomplete.data.productos.push({ codigo:'X' });
  assert.match(validateBackupPayload(incomplete).reason, /Falta la columna/);
});
