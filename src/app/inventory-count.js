/**
 * Selecciona los productos que deben pasar por el único reconteo.
 * Si no hay discrepancias iniciales, no se solicita un reconteo aleatorio.
 * Si las hay, se mezcla una muestra adicional del 20% de los coincidentes.
 */
export function selectInventoryRecountRows(details = [], random = Math.random) {
  const mismatches = details.filter(row => Number(row.conteo_1) !== Number(row.esperado_al_contar));
  const matching = details.filter(row => Number(row.conteo_1) === Number(row.esperado_al_contar));
  if (mismatches.length === 0) {
    return { mismatches, matching, selected: [] };
  }

  const extraCount = Math.ceil(matching.length * 0.2);
  const shuffled = matching.slice();
  for (let index = shuffled.length - 1; index > 0; index--) {
    const sample = Number(random());
    const target = Math.min(index, Math.max(0, Math.floor(sample * (index + 1))));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return {
    mismatches,
    matching,
    selected: [...mismatches, ...shuffled.slice(0, extraCount)]
  };
}

/**
 * Clasifica el reconteo según la regla V2:
 * - dos lecturas distintas: inconsistente;
 * - dos lecturas iguales al stock esperado: coincide;
 * - dos lecturas iguales entre sí pero distintas del esperado: revisión admin.
 */
export function recountResult(expected, first, second) {
  if (Number(first) !== Number(second)) return 'inconsistente';
  if (Number(second) === Number(expected)) return 'coincide';
  return 'pendiente_verificar';
}


/** Etiqueta neutra para el dependiente durante el reconteo, sin mostrar cantidades. */
export function recountProgressLabel(row) {
  return row.conteo_2 === null || row.conteo_2 === undefined
    ? 'Pendiente de reconteo'
    : 'Reconteo registrado';
}
