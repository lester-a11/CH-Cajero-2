/**
 * Acumula caracteres HID enviados por un lector de códigos.
 * Un escaneo se completa con Enter y se invalida si hay más de 100 ms
 * entre caracteres. Los códigos se tratan como texto, sin asumir formato.
 */
export class BarcodeBuffer {
  constructor({ maxGapMs = 100, minLength = 4, maxLength = 128 } = {}) {
    this.maxGapMs = maxGapMs;
    this.minLength = minLength;
    this.maxLength = maxLength;
    this.value = '';
    this.lastAt = 0;
  }

  push(character, timestamp = Date.now()) {
    if (typeof character !== 'string' || [...character].length !== 1 || /[\u0000-\u001f\u007f]/u.test(character)) {
      return false;
    }
    if (this.lastAt && timestamp - this.lastAt > this.maxGapMs) this.reset();
    this.lastAt = timestamp;
    if (this.value.length < this.maxLength) this.value += character;
    return true;
  }

  finish(timestamp = Date.now()) {
    if (this.lastAt && timestamp - this.lastAt > this.maxGapMs) {
      this.reset();
      return null;
    }
    const code = this.value.trim();
    this.reset();
    return code.length >= this.minLength ? code : null;
  }

  reset() {
    this.value = '';
    this.lastAt = 0;
  }
}
