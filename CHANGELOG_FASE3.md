# Cambios — Fase 3 (1.2.0)

- Añadidas pruebas para planificación de importación de catálogo y producto individual.
- Añadidas pruebas de validación estricta de respaldos.
- Añadidas pruebas del resumen diario de caja.
- Corregido el resumen de caja para aceptar filas SQLite (`monto_original`, `equivalente_usd`, `vuelto_moneda`, `vuelto_monto`) y estructura exportada.
- Corregida la vista previa de cierre diario para mostrar el efectivo esperado neto después de descontar el vuelto, además de los importes brutos por método.
- La auditoría de alta de producto identifica al usuario cuyo PIN autorizó la operación.
- Añadido `scripts/verify-phase3.sh` para ejecutar pruebas de las tres primeras fases y el importador PC.
- Actualizada la versión del proyecto a 1.2.0.
