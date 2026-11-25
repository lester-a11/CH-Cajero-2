/**
 * Construye el evento exacto que se firma en la cadena de auditoría.
 * `action` es el nombre del parámetro de la API JS; en SQLite/JSON el campo
 * contractual se llama `accion` para mantener compatibilidad con el importador PC.
 */
export function buildAuditEvent({
  fecha_hora,
  usuario_id = null,
  usuario,
  action,
  detalle,
  turno_id = null,
  hash_anterior = null
}) {
  if (typeof action !== 'string' || !action.trim()) {
    throw new TypeError('La acción de auditoría es obligatoria.');
  }
  return {
    fecha_hora,
    usuario_id,
    usuario,
    accion: action,
    detalle,
    turno_id,
    hash_anterior
  };
}
