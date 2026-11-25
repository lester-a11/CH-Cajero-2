import { strToU8, strFromU8, zipSync, unzipSync } from 'fflate';

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]));
  }
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) return Math.trunc(value);
  return value;
}

export function canonicalJSON(value) {
  return JSON.stringify(normalize(value));
}

export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

export async function signPayload(payload) {
  const unsigned = { ...payload };
  delete unsigned.hash;
  const hash = await sha256Hex(canonicalJSON(unsigned));
  return { ...unsigned, hash: `sha256-${hash}` };
}

export async function verifyPayload(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.hash !== 'string') return false;
  const claimed = payload.hash.replace(/^sha256-/, '');
  const unsigned = { ...payload };
  delete unsigned.hash;
  return claimed === await sha256Hex(canonicalJSON(unsigned));
}

export function createZip(entries) {
  const mapped = {};
  for (const [name, value] of Object.entries(entries)) {
    mapped[name] = typeof value === 'string' ? strToU8(value) : value;
  }
  return zipSync(mapped, { level: 6 });
}

function inspectZipDirectory(bytes, { maxFiles = 500, maxTotalBytes = 100 * 1024 * 1024, maxFileBytes = 30 * 1024 * 1024 } = {}) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = 0x06054b50;
  const minimum = Math.max(0, bytes.byteLength - 65_557);
  let eocd = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === signature) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('El ZIP está incompleto o no tiene directorio central.');
  const count = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || directorySize === 0xffffffff || offset === 0xffffffff) {
    throw new Error('No se admiten ZIP64 en los archivos de intercambio.');
  }
  if (count > maxFiles || offset + directorySize > bytes.byteLength) throw new Error('El ZIP excede los límites permitidos o está dañado.');
  const names = new Set();
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Directorio central ZIP inválido.');
    const flags = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (flags & 1) throw new Error('No se admiten archivos ZIP cifrados.');
    if (uncompressed === 0xffffffff || compressed === 0xffffffff) throw new Error('No se admiten entradas ZIP64.');
    if (uncompressed > maxFileBytes) throw new Error('Un archivo dentro del ZIP supera el límite de tamaño.');
    total += uncompressed;
    if (total > maxTotalBytes) throw new Error('El contenido descomprimido supera el límite de 100 MB.');
    const nameStart = offset + 46;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    const name = new TextDecoder().decode(nameBytes).replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.split('/').some(part => part === '..')) {
      throw new Error('El ZIP contiene una ruta de archivo no permitida.');
    }
    if (names.has(name)) throw new Error(`El ZIP contiene un archivo duplicado: ${name}`);
    names.add(name);
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return names;
}

export function readZip(bytes, limits = {}) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  if (bytes.byteLength > (limits.maxInputBytes || 50 * 1024 * 1024)) throw new Error('El ZIP supera el límite de 50 MB.');
  inspectZipDirectory(bytes, limits);
  const archive = unzipSync(bytes);
  const result = {};
  for (const [name, content] of Object.entries(archive)) result[name] = content;
  return result;
}

export function zipText(bytes) {
  return strFromU8(bytes);
}
