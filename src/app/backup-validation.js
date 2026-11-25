/** Validación de respaldos antiguos y del esquema ampliado de CH Cajero V2. */
export const BACKUP_TABLE_COLUMNS = Object.freeze({
  productos: ['codigo','nombre','precio_usd','stock','stock_inicial','foto_base64','origen','pendiente_sync','actualizado_en','creado_en','creado_por'],
  usuarios: ['id','nombre','pin_hash','rol','activo','creado_en'],
  config: ['clave','valor'],
  jornadas: ['id','fecha','tasa_cup','recargo_transferencia','estado','abierta_en','cerrada_en'],
  turnos: ['id','usuario_id','inicio','fin'],
  ventas: ['id','numero_local','jornada_id','fecha_hora','dependiente_id','turno_id','estado','total_usd','tasa_cup','recargo_transf','motivo_anulacion','vuelto_moneda','vuelto_monto'],
  lineas_venta: ['id','venta_id','codigo','nombre_snapshot','precio_snapshot','cantidad','anulada','motivo_anulacion'],
  pagos: ['id','venta_id','metodo','monto_original','moneda','tasa_aplicada','equivalente_usd','fecha_hora','estado','anulado_por','anulado_en','turno_id'],
  movimientos_inventario: ['id','tipo','codigo','cantidad','fecha_hora','usuario_id','usuario','turno_id','motivo','nota','estado','movimiento_origen','stock_antes','stock_despues'],
  conteos: ['id','fecha_inicio','fecha_fin','usuario_id','turno_id','estado'],
  conteo_detalle: ['id','conteo_id','codigo','esperado_al_contar','conteo_1','hora_1','conteo_2','hora_2','resultado','decision_admin','motivo','visible_para'],
  cierres: ['id','fecha','archivo_generado','hash','generado_en','exportado_en','payload_json','secuencia','hash_anterior'],
  auditoria: ['id','fecha_hora','usuario_id','usuario','accion','detalle','turno_id','hash_anterior','hash_evento']
});

const LEGACY_V2_COLUMNS = Object.freeze({
  ...Object.fromEntries(Object.entries(BACKUP_TABLE_COLUMNS).map(([table, columns]) => [table, table === 'productos' ? columns.filter(column => column !== 'stock_inicial') : table === 'movimientos_inventario' ? columns.filter(column => !['stock_antes','stock_despues'].includes(column)) : columns])),
});

const LEGACY_V1_COLUMNS = Object.freeze({
  productos: ['codigo','nombre','precio_usd','stock','foto_base64','origen','pendiente_sync','actualizado_en'],
  usuarios: ['id','nombre','pin_hash','rol','activo','creado_en'],
  config: ['clave','valor'],
  jornadas: ['id','fecha','tasa_cup','recargo_transferencia','estado','abierta_en','cerrada_en'],
  ventas: ['id','numero_local','jornada_id','fecha_hora','dependiente_id','estado','total_usd','tasa_cup','recargo_transf','motivo_anulacion','vuelto_moneda','vuelto_monto'],
  lineas_venta: ['id','venta_id','codigo','nombre_snapshot','precio_snapshot','cantidad','anulada','motivo_anulacion'],
  pagos: ['id','venta_id','metodo','monto_original','moneda','tasa_aplicada','equivalente_usd','fecha_hora'],
  cierres: ['id','fecha','archivo_generado','hash','generado_en','exportado_en','payload_json'],
  auditoria: ['id','fecha_hora','usuario_id','usuario','accion','detalle']
});

export function validateBackupPayload(payload) {
  const version = Number(payload?.version);
  if (!payload || typeof payload !== 'object' || payload.tipo !== 'respaldo_cajero' || ![1,2].includes(version)) {
    return { valid: false, reason: 'El archivo no es un respaldo CH Cajero compatible (versión 1 o 2).' };
  }
  if (!payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    return { valid: false, reason: 'El respaldo no contiene la sección data.' };
  }
  const requiredSchema = version === 1 ? LEGACY_V1_COLUMNS : LEGACY_V2_COLUMNS;
  const tables = Object.keys(requiredSchema);
  const extraTable = Object.keys(payload.data).find(table => !tables.includes(table));
  if (extraTable) return { valid: false, reason: `Tabla no permitida en el respaldo: ${extraTable}.` };
  const rowCounts = {};
  for (const table of tables) {
    const rows = payload.data[table];
    if (!Array.isArray(rows)) return { valid: false, reason: `Falta la tabla ${table} o no es una lista.` };
    rowCounts[table] = rows.length;
    const allowed = new Set(requiredSchema[table]);
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { valid: false, reason: `Registro ${index + 1} de ${table} no válido.` };
      }
      const keys = Object.keys(row);
      const unknown = keys.find(key => !allowed.has(key));
      if (unknown) return { valid: false, reason: `Columna no permitida en ${table}: ${unknown}.` };
      const missing = requiredSchema[table].find(key => !Object.hasOwn(row, key));
      if (missing) return { valid: false, reason: `Falta la columna ${missing} en un registro de ${table}.` };
    }
  }
  return { valid: true, version, rowCounts };
}

/** Convierte los respaldos V1 en filas completas del esquema V2 sin descartar registros. */
export function normalizeBackupData(payload) {
  const data = Object.fromEntries(Object.keys(BACKUP_TABLE_COLUMNS).map(table => [table, []]));
  for (const [table, rows] of Object.entries(payload.data || {})) data[table] = rows.map(row => ({ ...row }));
  if (Number(payload.version) === 1) {
    data.productos = data.productos.map(row => ({ ...row, stock_inicial: row.stock, creado_en: null, creado_por: null }));
    data.ventas = data.ventas.map(row => ({ ...row, turno_id: null }));
    data.pagos = data.pagos.map(row => ({ ...row, estado: 'activo', anulado_por: null, anulado_en: null, turno_id: null }));
    data.cierres = data.cierres.map(row => ({ ...row, secuencia: null, hash_anterior: null }));
    data.auditoria = data.auditoria.map(row => ({ ...row, turno_id: null, hash_anterior: null, hash_evento: null }));
  } else if (Number(payload.version) === 2) {
    data.productos = data.productos.map(row => ({ ...row, stock_inicial: row.stock }));
    data.movimientos_inventario = data.movimientos_inventario.map(row => ({ ...row, stock_antes: null, stock_despues: null }));
  }
  return data;
}
