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


## 2.0.1 — correcciones de auditoría y conteo

- Corregido el evento de auditoría: el hash se construye con la propiedad contractual `accion` a partir del parámetro `action`; antes se referenciaba una variable inexistente y podían fallar operaciones que registran auditoría.
- Añadida prueba de serialización del evento y compatibilidad SHA-256 entre JavaScript y el importador Python.
- Corregido el flujo del conteo: sin diferencias iniciales no se solicita reconteo aleatorio; con diferencias se recontean todos los discrepantes y una muestra del 20 % de los coincidentes.
- Corregida la clasificación del segundo conteo: lecturas distintas se marcan `inconsistente`; dos lecturas iguales que aún difieren del esperado quedan `pendiente_verificar`; solo dos lecturas que coinciden con el esperado se confirman.
- El panel administrativo incluye los resultados `inconsistente` y `pendiente_verificar`.
- La vista del dependiente oculta las cantidades del primer conteo durante el reconteo y muestra solo un estado neutral.
- Corregido el verificador de Fase 1 para validar el ZIP de catálogo con su formato real, sin pasarlo al importador de cierres.
- Versión fuente 2.0.1; Android `versionCode 5`, `versionName 2.0.1`.

La corrección no convierte esta entrega en una APK lista para producción. Siguen pendientes los requisitos de dinero en centavos enteros, respaldos automáticos cifrados, alertas avanzadas de PC, suite integral con `fflate`, compilación Android y pruebas físicas. Ver `ESTADO.md` e `INFORME_REPARACION_V2.md`.
