import { roundMoney, calculateDrawerBalances } from './money.js';

/** Resume la jornada. Acepta filas SQLite (monto_original/equivalente_usd) y
 * objetos exportados (monto/equiv_usd), manteniendo una sola regla de cálculo. */
export function summarizeDayClosure(sales) {
  const closed = sales.filter(sale => sale.estado === 'cerrada');
  const voided = sales.filter(sale => sale.estado === 'anulada');
  const payments = closed.flatMap(sale => (sale.pagos || []).map(payment => ({
    ...payment,
    monto: Number(payment.monto ?? payment.monto_original ?? 0),
    equiv_usd: Number(payment.equiv_usd ?? payment.equivalente_usd ?? 0)
  })));
  const changes = closed.map(sale => sale.vuelto || {
    moneda: sale.vuelto_moneda || null,
    monto: Number(sale.vuelto_monto || 0)
  });
  const drawer = calculateDrawerBalances(payments, changes);
  const byMethod = {};
  for (const payment of payments) {
    if (!byMethod[payment.metodo]) byMethod[payment.metodo] = {
      monto_original: 0, moneda: payment.moneda, equivalente_usd: 0
    };
    byMethod[payment.metodo].monto_original = roundMoney(
      byMethod[payment.metodo].monto_original + Number(payment.monto || 0)
    );
    byMethod[payment.metodo].equivalente_usd = roundMoney(
      byMethod[payment.metodo].equivalente_usd + Number(payment.equiv_usd || 0)
    );
  }
  return {
    n_ventas: closed.length,
    total_usd: roundMoney(closed.reduce((sum, sale) => sum + Number(sale.total_usd || 0), 0)),
    por_metodo: byMethod,
    efectivo_usd_esperado: drawer.efectivo_usd_esperado,
    efectivo_cup_esperado: drawer.efectivo_cup_esperado,
    transferencias: drawer.transferencias,
    anulaciones: voided.length
  };
}
