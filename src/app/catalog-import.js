/** Validación y planificación de importaciones de catálogo/productos.
 * No modifica la base de datos: la app presenta el plan y solo lo aplica tras confirmación.
 */
const safeRelativePath = value => {
  if (typeof value !== 'string' || !value.trim()) return false;
  const path = value.replace(/\\/g, '/');
  return !path.startsWith('/') && !/^[A-Za-z]:/.test(path)
    && path.split('/').every(part => part && part !== '.' && part !== '..');
};

function validateProduct(raw, archiveNames) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'La fila no es un objeto de producto.' };
  const codigo = String(raw.codigo ?? '').trim();
  const nombre = String(raw.nombre ?? '').trim();
  const precio = Number(raw.precio_usd);
  const stock = Number(raw.stock ?? 0);
  if (!codigo) return { ok: false, reason: 'Falta el código/ID.' };
  if (codigo.length > 80) return { ok: false, reason: 'El código supera 80 caracteres.' };
  if (!nombre) return { ok: false, reason: 'Falta el nombre.' };
  if (nombre.length > 120) return { ok: false, reason: 'El nombre supera 120 caracteres.' };
  if (!Number.isFinite(precio) || precio < 0 || precio > 1_000_000_000) return { ok: false, reason: 'Precio USD inválido.' };
  if (!Number.isInteger(stock) || stock < 0 || stock > 2_147_483_647) return { ok: false, reason: 'El stock debe ser un entero no negativo.' };
  let foto = null;
  if (raw.foto !== undefined && raw.foto !== null && raw.foto !== '') {
    if (!safeRelativePath(raw.foto)) return { ok: false, reason: 'La ruta de fotografía no es segura.' };
    if (!archiveNames.has(raw.foto)) return { ok: false, reason: `No se encuentra la fotografía ${raw.foto}.` };
    foto = raw.foto;
  }
  return { ok: true, product: { codigo, nombre, precio_usd: Math.round((precio + Number.EPSILON) * 100) / 100, stock, foto } };
}

export function buildCatalogImportPlan(catalog, existingProducts = [], archiveNames = []) {
  if (!catalog || typeof catalog !== 'object' || catalog.tipo !== 'catalogo' || Number(catalog.version) !== 1 || !Array.isArray(catalog.productos)) {
    throw new Error('El archivo no contiene un catálogo CH Cajero versión 1.');
  }
  const existing = new Map(existingProducts.map(product => [String(product.codigo), product]));
  const names = new Set(archiveNames);
  const seen = new Set();
  const rows = [];
  for (let index = 0; index < catalog.productos.length; index++) {
    const checked = validateProduct(catalog.productos[index], names);
    if (!checked.ok) {
      rows.push({ index: index + 1, status: 'error', reason: checked.reason, product: null });
      continue;
    }
    const product = checked.product;
    if (seen.has(product.codigo)) {
      rows.push({ index: index + 1, codigo: product.codigo, nombre: product.nombre, status: 'error', reason: 'Código repetido dentro del archivo.', product: null });
      continue;
    }
    seen.add(product.codigo);
    const current = existing.get(product.codigo) || null;
    rows.push({ index: index + 1, codigo: product.codigo, nombre: product.nombre,
      status: current ? 'actualizar' : 'nuevo', reason: '', product, current });
  }
  const inventoryCorrected = Boolean(catalog.inventario_corregido);
  return {
    kind: 'catalogo',
    inventoryCorrected,
    mode: String(catalog.modo || 'upsert'),
    rows,
    created: rows.filter(row => row.status === 'nuevo').length,
    updated: rows.filter(row => row.status === 'actualizar').length,
    errors: rows.filter(row => row.status === 'error').length,
    applicable: rows.filter(row => row.product).length
  };
}

export function buildSingleProductImportPlan(payload, existingProducts = [], archiveNames = []) {
  if (!payload || typeof payload !== 'object' || payload.tipo !== 'producto' || Number(payload.version) !== 1) {
    throw new Error('El archivo no contiene un producto CH Cajero versión 1.');
  }
  const checked = validateProduct(payload.producto, new Set(archiveNames));
  if (!checked.ok) {
    return { kind: 'producto', inventoryCorrected: false, rows: [{ index: 1, status: 'error', reason: checked.reason }], created: 0, updated: 0, errors: 1, applicable: 0 };
  }
  const existing = new Map(existingProducts.map(product => [String(product.codigo), product]));
  const product = checked.product;
  const current = existing.get(product.codigo) || null;
  const row = current
    ? { index: 1, codigo: product.codigo, nombre: product.nombre, status: 'error', reason: 'El código ya existe. Los archivos de producto individual solo incorporan productos nuevos.', product: null, current }
    : { index: 1, codigo: product.codigo, nombre: product.nombre, status: 'nuevo', reason: '', product, current: null };
  return { kind: 'producto', inventoryCorrected: false, rows: [row], created: row.product ? 1 : 0, updated: 0, errors: row.product ? 0 : 1, applicable: row.product ? 1 : 0 };
}

export function applyableRows(plan) {
  return plan.rows.filter(row => row.product && ['nuevo', 'actualizar'].includes(row.status));
}
