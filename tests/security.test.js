import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPin, verifyPin } from '../src/app/security.js';

test('el PIN se almacena como hash PBKDF2 con sal y nunca en texto plano', async () => {
  const stored = await hashPin('4826');
  assert.match(stored, /^pbkdf2\$150000\$/);
  assert.equal(stored.includes('4826'), false);
  assert.equal(await verifyPin('4826', stored), true);
  assert.equal(await verifyPin('4827', stored), false);
});

test('rechaza PIN fuera del rango de 4 a 8 dígitos', async () => {
  await assert.rejects(() => hashPin('123'), /4 y 8 dígitos/);
  await assert.rejects(() => hashPin('123456789'), /4 y 8 dígitos/);
});
