const ITERATIONS = 150000;
const encoder = new TextEncoder();

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

export async function hashPin(pin) {
  const normalized = String(pin ?? '');
  if (!/^\d{4,8}$/.test(normalized)) throw new Error('El PIN debe tener entre 4 y 8 dígitos.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(normalized), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, key, 256
  );
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

export async function verifyPin(pin, stored) {
  try {
    const [algorithm, count, saltText, hashText] = String(stored).split('$');
    if (algorithm !== 'pbkdf2' || !count || !saltText || !hashText) return false;
    const key = await crypto.subtle.importKey('raw', encoder.encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: fromBase64(saltText), iterations: Number(count), hash: 'SHA-256' }, key, 256
    );
    const actual = new Uint8Array(bits);
    const expected = fromBase64(hashText);
    if (actual.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < actual.length; i++) mismatch |= actual[i] ^ expected[i];
    return mismatch === 0;
  } catch {
    return false;
  }
}
