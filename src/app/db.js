import { Capacitor, registerPlugin } from '@capacitor/core';
import { buildAuditEvent } from './audit-event.js';

const NativeSQLite = registerPlugin('SQLiteBridge');
let initialized = false;

const schema = [
  `CREATE TABLE IF NOT EXISTS productos (
    codigo TEXT PRIMARY KEY, nombre TEXT NOT NULL, precio_usd REAL NOT NULL CHECK(precio_usd >= 0),
    stock INTEGER NOT NULL DEFAULT 0, stock_inicial INTEGER, foto_base64 TEXT, origen TEXT NOT NULL DEFAULT 'catalogo',
    pendiente_sync INTEGER NOT NULL DEFAULT 0, actualizado_en TEXT NOT NULL,
    creado_en TEXT, creado_por TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY, nombre TEXT NOT NULL, pin_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK(rol IN ('dependiente','administrador')), activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jornadas (
    id TEXT PRIMARY KEY, fecha TEXT NOT NULL UNIQUE, tasa_cup REAL NOT NULL,
    recargo_transferencia REAL NOT NULL DEFAULT 20, estado TEXT NOT NULL CHECK(estado IN ('abierta','cerrada')),
    abierta_en TEXT NOT NULL, cerrada_en TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS turnos (
    id TEXT PRIMARY KEY, usuario_id TEXT NOT NULL, inicio TEXT NOT NULL, fin TEXT,
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS ventas (
    id TEXT PRIMARY KEY, numero_local INTEGER NOT NULL, jornada_id TEXT NOT NULL,
    fecha_hora TEXT NOT NULL, dependiente_id TEXT NOT NULL, turno_id TEXT,
    estado TEXT NOT NULL CHECK(estado IN ('abierta','pausada','cerrada','anulada','cancelada')),
    total_usd REAL NOT NULL DEFAULT 0, tasa_cup REAL NOT NULL,
    recargo_transf REAL NOT NULL DEFAULT 20, motivo_anulacion TEXT,
    vuelto_moneda TEXT, vuelto_monto REAL NOT NULL DEFAULT 0,
    FOREIGN KEY(jornada_id) REFERENCES jornadas(id), FOREIGN KEY(dependiente_id) REFERENCES usuarios(id),
    FOREIGN KEY(turno_id) REFERENCES turnos(id)
  )`,
  `CREATE TABLE IF NOT EXISTS lineas_venta (
    id TEXT PRIMARY KEY, venta_id TEXT NOT NULL, codigo TEXT NOT NULL,
    nombre_snapshot TEXT NOT NULL, precio_snapshot REAL NOT NULL,
    cantidad INTEGER NOT NULL CHECK(cantidad > 0), anulada INTEGER NOT NULL DEFAULT 0,
    motivo_anulacion TEXT, FOREIGN KEY(venta_id) REFERENCES ventas(id)
  )`,
  `CREATE TABLE IF NOT EXISTS pagos (
    id TEXT PRIMARY KEY, venta_id TEXT NOT NULL,
    metodo TEXT NOT NULL CHECK(metodo IN ('USD','CUP','TRANSFER')),
    monto_original REAL NOT NULL, moneda TEXT NOT NULL,
    tasa_aplicada REAL NOT NULL, equivalente_usd REAL NOT NULL,
    fecha_hora TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','anulado')),
    anulado_por TEXT, anulado_en TEXT, turno_id TEXT,
    FOREIGN KEY(venta_id) REFERENCES ventas(id), FOREIGN KEY(turno_id) REFERENCES turnos(id)
  )`,
  `CREATE TABLE IF NOT EXISTS movimientos_inventario (
    id TEXT PRIMARY KEY, tipo TEXT NOT NULL CHECK(tipo IN ('entrada','salida','ajuste_conteo')),
    codigo TEXT NOT NULL, cantidad INTEGER NOT NULL, fecha_hora TEXT NOT NULL,
    usuario_id TEXT NOT NULL, usuario TEXT NOT NULL, turno_id TEXT, motivo TEXT, nota TEXT,
    estado TEXT NOT NULL CHECK(estado IN ('confirmado','pendiente_confirmacion')),
    movimiento_origen TEXT, stock_antes INTEGER, stock_despues INTEGER,
    FOREIGN KEY(codigo) REFERENCES productos(codigo), FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
  )`,
  `CREATE TABLE IF NOT EXISTS conteos (
    id TEXT PRIMARY KEY, fecha_inicio TEXT NOT NULL, fecha_fin TEXT,
    usuario_id TEXT NOT NULL, turno_id TEXT, estado TEXT NOT NULL
      CHECK(estado IN ('en_curso','reconteo','confirmado','revisado')),
    FOREIGN KEY(usuario_id) REFERENCES usuarios(id), FOREIGN KEY(turno_id) REFERENCES turnos(id)
  )`,
  `CREATE TABLE IF NOT EXISTS conteo_detalle (
    id TEXT PRIMARY KEY, conteo_id TEXT NOT NULL, codigo TEXT NOT NULL,
    esperado_al_contar INTEGER NOT NULL, conteo_1 INTEGER, hora_1 TEXT,
    conteo_2 INTEGER, hora_2 TEXT,
    resultado TEXT NOT NULL CHECK(resultado IN ('coincide','pendiente_verificar','inconsistente','reconteo_pendiente')),
    decision_admin TEXT, motivo TEXT, visible_para TEXT,
    FOREIGN KEY(conteo_id) REFERENCES conteos(id), FOREIGN KEY(codigo) REFERENCES productos(codigo)
  )`,
  `CREATE TABLE IF NOT EXISTS cierres (
    id TEXT PRIMARY KEY, fecha TEXT NOT NULL, archivo_generado TEXT NOT NULL,
    hash TEXT NOT NULL, generado_en TEXT NOT NULL, exportado_en TEXT,
    payload_json TEXT NOT NULL, secuencia INTEGER, hash_anterior TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS auditoria (
    id TEXT PRIMARY KEY, fecha_hora TEXT NOT NULL, usuario_id TEXT,
    usuario TEXT NOT NULL, accion TEXT NOT NULL, detalle TEXT NOT NULL,
    turno_id TEXT, hash_anterior TEXT, hash_evento TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ventas_jornada ON ventas(jornada_id, estado)`,
  `CREATE INDEX IF NOT EXISTS idx_ventas_turno ON ventas(turno_id, estado)`,
  `CREATE INDEX IF NOT EXISTS idx_lineas_venta ON lineas_venta(venta_id)`,
  `CREATE INDEX IF NOT EXISTS idx_pagos_venta ON pagos(venta_id, estado)`,
  `CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON auditoria(fecha_hora)`,
  `CREATE INDEX IF NOT EXISTS idx_movimientos_codigo_fecha ON movimientos_inventario(codigo,fecha_hora)`,
  `CREATE INDEX IF NOT EXISTS idx_conteos_estado ON conteos(estado)`
];

const legacySalesColumns = [
  'id','numero_local','jornada_id','fecha_hora','dependiente_id','turno_id','estado',
  'total_usd','tasa_cup','recargo_transf','motivo_anulacion','vuelto_moneda','vuelto_monto'
];

async function hasColumn(table, column) {
  const columns = await query(`PRAGMA table_info(${table})`);
  return columns.some(item => item.name === column);
}

async function ensureColumn(table, column, definition) {
  if (!(await hasColumn(table, column))) await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function migrateSalesCancellationState() {
  const row = await one("SELECT sql FROM sqlite_master WHERE type='table' AND name='ventas'");
  if (!row?.sql || row.sql.includes("'cancelada'")) return;

  // La tabla antigua restringía los estados. Se reconstruye conservando cada columna y registro.
  await execute('PRAGMA foreign_keys=OFF');
  try {
    await execute('BEGIN TRANSACTION');
    await execute(`CREATE TABLE ventas_v2 (
      id TEXT PRIMARY KEY, numero_local INTEGER NOT NULL, jornada_id TEXT NOT NULL,
      fecha_hora TEXT NOT NULL, dependiente_id TEXT NOT NULL, turno_id TEXT,
      estado TEXT NOT NULL CHECK(estado IN ('abierta','pausada','cerrada','anulada','cancelada')),
      total_usd REAL NOT NULL DEFAULT 0, tasa_cup REAL NOT NULL,
      recargo_transf REAL NOT NULL DEFAULT 20, motivo_anulacion TEXT,
      vuelto_moneda TEXT, vuelto_monto REAL NOT NULL DEFAULT 0,
      FOREIGN KEY(jornada_id) REFERENCES jornadas(id), FOREIGN KEY(dependiente_id) REFERENCES usuarios(id),
      FOREIGN KEY(turno_id) REFERENCES turnos(id)
    )`);
    const oldColumns = await query('PRAGMA table_info(ventas)');
    const oldNames = new Set(oldColumns.map(item => item.name));
    const selectColumns = legacySalesColumns.map(name => oldNames.has(name) ? name : (name === 'turno_id' ? 'NULL AS turno_id' : name));
    await execute(`INSERT INTO ventas_v2(${legacySalesColumns.join(',')}) SELECT ${selectColumns.join(',')} FROM ventas`);
    await execute('DROP TABLE ventas');
    await execute('ALTER TABLE ventas_v2 RENAME TO ventas');
    await execute('CREATE INDEX IF NOT EXISTS idx_ventas_jornada ON ventas(jornada_id, estado)');
    await execute('CREATE INDEX IF NOT EXISTS idx_ventas_turno ON ventas(turno_id, estado)');
    await execute('COMMIT');
  } catch (error) {
    try { await execute('ROLLBACK'); } catch { /* conserva error original */ }
    throw error;
  } finally {
    await execute('PRAGMA foreign_keys=ON');
  }
}

async function migrateExistingDatabase() {
  await ensureColumn('productos', 'stock_inicial', 'INTEGER');
  await ensureColumn('productos', 'creado_en', 'TEXT');
  await ensureColumn('productos', 'creado_por', 'TEXT');
  await execute('UPDATE productos SET stock_inicial=stock WHERE stock_inicial IS NULL');
  await ensureColumn('ventas', 'turno_id', 'TEXT');
  await migrateSalesCancellationState();
  await ensureColumn('movimientos_inventario', 'stock_antes', 'INTEGER');
  await ensureColumn('movimientos_inventario', 'stock_despues', 'INTEGER');
  await ensureColumn('pagos', 'estado', "TEXT NOT NULL DEFAULT 'activo'");
  await ensureColumn('pagos', 'anulado_por', 'TEXT');
  await ensureColumn('pagos', 'anulado_en', 'TEXT');
  await ensureColumn('pagos', 'turno_id', 'TEXT');
  await ensureColumn('cierres', 'secuencia', 'INTEGER');
  await ensureColumn('cierres', 'hash_anterior', 'TEXT');
  await ensureColumn('auditoria', 'turno_id', 'TEXT');
  await ensureColumn('auditoria', 'hash_anterior', 'TEXT');
  await ensureColumn('auditoria', 'hash_evento', 'TEXT');
}

export async function initDatabase() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('La base de datos SQLite y el lector USB requieren instalar la APK Android.');
  }
  if (initialized) return;
  await NativeSQLite.open({});
  for (const statement of schema) {
    // Los índices que contienen columnas nuevas se crean al final de las migraciones.
    if (statement.startsWith('CREATE INDEX')) continue;
    await NativeSQLite.execute({ sql: statement, values: [] });
  }
  await migrateExistingDatabase();
  for (const statement of schema.filter(item => item.startsWith('CREATE INDEX'))) {
    await NativeSQLite.execute({ sql: statement, values: [] });
  }
  initialized = true;
}

export async function execute(sql, values = []) {
  return NativeSQLite.execute({ sql, values });
}

export async function run(sql, values = []) {
  return NativeSQLite.run({ sql, values });
}

export async function query(sql, values = []) {
  const result = await NativeSQLite.query({ sql, values });
  return result.rows || [];
}

export async function one(sql, values = []) {
  const rows = await query(sql, values);
  return rows[0] || null;
}

function bytesToHex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value) {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export async function audit(user, action, detail) {
  const fecha_hora = new Date().toISOString();
  const usuario = user?.nombre || 'Sistema';
  const usuario_id = user?.id || null;
  const turno_id = user?.turno_id || null;
  const detalle = typeof detail === 'string' ? detail : JSON.stringify(detail);
  const previous = await one('SELECT hash_evento FROM auditoria WHERE hash_evento IS NOT NULL ORDER BY rowid DESC LIMIT 1');
  const hash_anterior = previous?.hash_evento || null;
  const event = buildAuditEvent({ fecha_hora, usuario_id, usuario, action, detalle, turno_id, hash_anterior });
  const hash_evento = await sha256Text(JSON.stringify(event));
  await run(
    `INSERT INTO auditoria(id,fecha_hora,usuario_id,usuario,accion,detalle,turno_id,hash_anterior,hash_evento)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    [crypto.randomUUID(), fecha_hora, usuario_id, usuario, action, detalle, turno_id, hash_anterior, hash_evento]
  );
}

export async function transaction(work) {
  await execute('BEGIN TRANSACTION');
  try {
    const result = await work();
    await execute('COMMIT');
    return result;
  } catch (error) {
    try { await execute('ROLLBACK'); } catch { /* conserva el error original */ }
    throw error;
  }
}
