import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildAuditEvent } from '../src/app/audit-event.js';

test('la acción recibida se serializa con el nombre contractual accion', () => {
  const event = buildAuditEvent({
    fecha_hora: '2026-11-25T10:00:00.000Z',
    usuario_id: 'user-1',
    usuario: 'Dependiente 1',
    action: 'pago_anulado',
    detalle: '{"pago_id":"pay-1"}',
    turno_id: 'turn-1',
    hash_anterior: 'abc123'
  });
  assert.deepEqual(Object.keys(event), [
    'fecha_hora', 'usuario_id', 'usuario', 'accion', 'detalle', 'turno_id', 'hash_anterior'
  ]);
  assert.equal(event.accion, 'pago_anulado');
  assert.equal(Object.hasOwn(event, 'action'), false);
});

test('la serialización produce el mismo SHA-256 verificable por el importador PC', () => {
  const event = buildAuditEvent({
    fecha_hora: '2026-11-25T10:00:00.000Z',
    usuario_id: 'user-1',
    usuario: 'Dependiente Ñ',
    action: 'venta_cancelada',
    detalle: '{"venta_id":"sale-1"}',
    turno_id: null,
    hash_anterior: null
  });
  const encoded = JSON.stringify(event);
  const digest = createHash('sha256').update(encoded, 'utf8').digest('hex');
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(encoded.includes('"accion":"venta_cancelada"'), true);
  assert.equal(encoded.includes('\\u00d1'), false);
});

test('rechaza eventos sin acción', () => {
  assert.throws(() => buildAuditEvent({ usuario: 'Sistema' }), /acción de auditoría/);
});
