import test from 'node:test';
import assert from 'node:assert/strict';
import { BarcodeBuffer } from '../src/app/barcode-buffer.js';

test('recibe texto rápido y lo entrega al terminar con Enter', () => {
  const buffer = new BarcodeBuffer();
  [...'6971449709288'].forEach((char, index) => buffer.push(char, 1000 + index * 20));
  assert.equal(buffer.finish(1280), '6971449709288');
  assert.equal(buffer.finish(1290), null);
});

test('descarta caracteres anteriores a una pausa superior a 100 ms', () => {
  const buffer = new BarcodeBuffer();
  buffer.push('A', 1000);
  buffer.push('B', 1020);
  buffer.push('1', 1201);
  buffer.push('2', 1220);
  buffer.push('3', 1240);
  assert.equal(buffer.finish(1250), null);
});

test('no interpreta una entrada de menos de cuatro caracteres como código', () => {
  const buffer = new BarcodeBuffer();
  ['1', '2', '3'].forEach((char, index) => buffer.push(char, 2000 + index * 10));
  assert.equal(buffer.finish(2040), null);
});

test('conserva caracteres de código como texto, incluidos ceros iniciales', () => {
  const buffer = new BarcodeBuffer();
  [...'00001234'].forEach((char, index) => buffer.push(char, 3000 + index * 10));
  assert.equal(buffer.finish(3100), '00001234');
});
