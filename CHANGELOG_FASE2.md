# Cambios de Fase 2 — versión 1.1.0

- Se consolidó el cobro mixto USD/CUP/transferencia conforme al Anexo A.1.
- Se centralizaron reglas de pago, saldo, vuelto y movimientos de stock en `src/app/sale-rules.js`.
- Se normalizan importes de pago a dos decimales y el teclado numérico no permite más de dos decimales.
- El cierre de venta vuelve a verificar estado y saldo antes de actualizar el inventario.
- Se añadieron bloqueos de acciones repetidas para pagos, cierres, pausas, reanudaciones y anulaciones.
- Las anulaciones conservan motivo y auditoría; la reposición no repite unidades ya repuestas.
- Se añadieron pruebas automatizadas y guía de aceptación manual de Fase 2.
- La documentación y el estado del proyecto se actualizaron a 1.1.0.
