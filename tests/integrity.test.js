import test from 'node:test';
import assert from 'node:assert/strict';
import { signPayload, verifyPayload, createZip, readZip, zipText, canonicalJSON } from '../src/app/integrity.js';

test('firma SHA-256 valida contenido y detecta modificación', async () => {
  const signed = await signPayload({ tipo: 'cierre_ventas', total: 3, detalle: { b: 2, a: 1 } });
  assert.equal(await verifyPayload(signed), true);
  const altered = { ...signed, total: 300 };
  assert.equal(await verifyPayload(altered), false);
});

test('canonización ordena claves y normaliza enteros', () => {
  assert.equal(canonicalJSON({ z: 1.0, a: { d: 2, c: 1 } }), '{"a":{"c":1,"d":2},"z":1}');
});

test('ZIP conserva cierre.json y contenido', () => {
  const zip = createZip({ 'cierre.json': '{"tipo":"cierre_ventas"}' });
  const files = readZip(zip);
  assert.equal(zipText(files['cierre.json']), '{"tipo":"cierre_ventas"}');
});
