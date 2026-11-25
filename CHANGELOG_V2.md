# CH Cajero 2.0.0 — cambios de la especificación V2

- Se conserva la arquitectura Capacitor + SQLite local y el modo offline.
- Se integra la pantalla de presentación minimalista CH solicitada en V2.
- Se agregan dos dependientes con PIN personal y turnos, junto con el modo administrador.
- Los pagos pueden anularse individualmente en ventas abiertas o pausadas; los importes activos se recalculan.
- Las ventas abiertas o pausadas se pueden cancelar sin alterar el stock; la anulación de ventas cerradas sigue siendo administrativa y auditada.
- Se incorpora la sección Inventario: entradas pendientes de confirmación, salidas administrativas, conteos ciegos y reconteos.
- Se genera cierre diario V3 con secuencia/hash anterior y se amplía el importador de PC para V1, V2 y V3.
- Se amplía la estructura SQLite con turnos, movimientos y datos de auditoría manteniendo compatibilidad/migración de la base previa.
- Se actualiza versionName a 2.0.0 y versionCode a 4.

Esta versión de fuente queda con pendientes obligatorios de calidad: importes persistidos en centavos enteros y respaldos automáticos cifrados. La compilación, firma y prueba física del APK tampoco se han realizado en este entorno. Ver `ESTADO.md`.
