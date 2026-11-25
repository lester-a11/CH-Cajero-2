# CH Cajero — Estado de actualización V2

**Versión fuente:** 2.0.0  
**Base de trabajo:** ZIP `CH_Cajero_Fase4(1).zip` (proyecto fuente 1.3.0) + especificación V2 fechada 24 nov 2026.  
**Arquitectura conservada:** Capacitor 8, interfaz web, SQLite local, integración Android/USB HID y funcionamiento offline.  
**Estado:** actualización funcional parcial en código fuente; no es todavía una entrega APK validada para producción.

## Cambios V2 incorporados en el código

- Pantalla de presentación con el logotipo CH transparente y el texto «Cajero», dos accesos de dependientes y acceso secundario a Administración.
- Inicio de sesión con PIN, usuarios administrador + dos dependientes y control de turno único abierto.
- Navegación inferior con Caja, Productos, Inventario e Historial; Administración visible solo en modo administrador.
- Pagos con estado `activo`/`anulado`; eliminación lógica individual con auditoría y recálculo de saldo/vuelto.
- Cancelación lógica de ventas abiertas o pausadas, sin descontar ni reponer stock; anulación administrativa separada para ventas cerradas.
- Migración aditiva de SQLite para estados nuevos y conservación de filas anteriores.
- Entradas de inventario con confirmación posterior del administrador, salidas administrativas con motivo, conteo ciego/reconteo y pendientes de verificación.
- Cierre diario formato V3 con turnos, movimientos de inventario, conteos, arqueo, secuencia, hash anterior y SHA-256.
- Importador de PC compatible con cierres V1, V2 y V3; control de cierres duplicados, integridad, secuencia y aplicación transaccional de inventario.
- Versión de la aplicación fuente actualizada a 2.0.0; Android versionCode 4 / versionName 2.0.0.

## Verificaciones ejecutadas

- `bash scripts/verify-phase4.sh`: completado correctamente.
- JavaScript: **33/33** pruebas disponibles aprobadas. El script detecta que falta `fflate` y omite únicamente la prueba dependiente de esa librería.
- Importador Python de la PC: **9/9** pruebas aprobadas, incluyendo V1/V2/V3, ventas canceladas, movimientos, duplicados y detección de alteraciones de hash/secuencia.
- `node --check` sobre los módulos JavaScript: correcto.
- `python3 -m py_compile pc/pc_tool.py`: correcto.
- Se comprobó la migración de la restricción del estado de venta y la preservación de registros antiguos en una base SQLite de prueba.

## Pendientes obligatorios antes de producción

1. **Dinero como enteros:** la implementación actual todavía utiliza números decimales JavaScript/SQLite para importes. La especificación V2 exige almacenar todos los importes en centavos enteros y usar una sola regla de redondeo. Esta migración requiere diseñar y probar una conversión de datos históricos; no debe improvisarse.
2. **Respaldos automáticos cifrados:** el proyecto conserva respaldo manual/restauración, pero falta el respaldo automático cifrado diario y antes de cada migración/actualización.
3. **Compilación APK:** no se generó APK en este entorno. `npm install` agotó el tiempo al descargar dependencias; no se ejecutaron `npm run build` ni Gradle/Android SDK aquí.
4. **Integridad completa:** la prueba `tests/integrity.test.js` depende de `fflate` y quedó sin ejecutar en este entorno. Debe ejecutarse `npm install && npm test` en GitHub Actions o en un equipo con red.
5. **Pruebas físicas:** falta probar la migración real con una copia de la base de datos del teléfono, la Netum L3 por OTG, ausencia del teclado virtual, cámara, selector de archivos, compartir por WhatsApp y restauración en el Redmi 14C.
6. **Alertas avanzadas de PC:** se generan alertas para entradas pendientes, conteos pendientes, diferencias de arqueo y discrepancias de stock. Falta completar toda la analítica avanzada especificada (repetición de faltantes, correcciones frecuentes, cancelaciones con dinero cobrado y correlación temporal de conteos/salidas).
7. **Firma de actualización:** para instalar encima de la APK actual se necesita exactamente la misma keystore de publicación que firmó la instalación existente. No se incluye ni se crea una clave privada en este ZIP.

## Instrucciones seguras

- Conserva la APK actual y crea un respaldo completo desde ella antes de probar esta versión.
- Sube el contenido de este proyecto a un repositorio privado GitHub y ejecuta **Actions → Compilar CH Cajero APK → Run workflow → debug** para pruebas iniciales.
- No instales un APK `release` encima de la aplicación actual hasta confirmar que se usa la misma keystore. Configura los cuatro secretos de firma documentados en README.
- No uses esta actualización como caja de producción hasta completar los requisitos obligatorios y todas las pruebas del dispositivo real.

## Resultado

La actualización V2 está aplicada al código fuente en las áreas principales de ventas, pagos, usuarios/turnos, inventario, cierre V3 e importador PC. Se entrega como proyecto fuente para continuar la validación; **no se afirma que el APK esté compilado, firmado o completamente conforme a todos los requisitos obligatorios de V2**.
