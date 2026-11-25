# CH Cajero — Estado de revisión V2.0.1

**Versión fuente:** 2.0.1  
**Versión Android configurada:** `versionCode 5`, `versionName 2.0.1`  
**Base:** proyecto fuente V2 recibido + especificación CH Cajero V2 (24 nov 2026).  
**Arquitectura conservada:** Capacitor 8, interfaz web, SQLite local, integración Android/USB HID y funcionamiento offline.  
**Estado:** correcciones de código aplicadas y pruebas locales parciales aprobadas; no es todavía una APK compilada, validada en dispositivo ni apta para producción.

## Correcciones aplicadas en 2.0.1

1. **Auditoría bloqueante:** la función de auditoría referenciaba `accion`, variable inexistente; ahora construye el evento con la propiedad persistida `accion: action`. Se conserva el formato contractual y se añadieron pruebas de serialización, validación y SHA-256 compatible con el importador Python.
2. **Conteo ciego sin diferencias:** ya no se genera reconteo aleatorio si todos los productos coinciden con el stock esperado.
3. **Conteo con diferencias:** se recontean todos los discrepantes y una muestra aleatoria del 20 % de los productos que inicialmente coincidían.
4. **Clasificación de reconteo:** dos cantidades distintas entre sí quedan como `inconsistente`; dos cantidades iguales entre sí pero distintas del stock esperado quedan `pendiente_verificar`; solo el resultado que coincide con el esperado se confirma automáticamente.
5. **Bandeja administrativa:** los resultados `inconsistente` y `pendiente_verificar` aparecen para revisión del administrador.
6. **Verificador de catálogo:** el script de Fase 1 ahora valida el `catalogo.json` y su SHA-256 según el formato del ZIP de catálogo; antes intentaba cargar ese ejemplo mediante el importador de cierres.
7. **Privacidad del reconteo:** la vista del dependiente ya no muestra las cantidades del primer o segundo conteo mientras recontea; solo muestra un estado neutro registrado/pendiente.

## Pruebas ejecutadas

- `bash scripts/verify-phase1.sh`: ejecutado; valida pruebas Fases 1 y 2, pruebas Python, sintaxis JS/Python y catálogo demo.
- `bash scripts/verify-phase3.sh`: ejecutado; valida pruebas de Fases 1–3, importador Python y sintaxis.
- `bash scripts/verify-phase4.sh`: ejecutado; al faltar `fflate`, usa la ruta de pruebas disponibles y declara explícitamente que la suite integral no se ejecutó.
- Pruebas unitarias nuevas: `tests/audit-event.test.js` y `tests/inventory-count.test.js`.
- Se verificó un evento SHA-256 producido por el módulo JavaScript contra el verificador de cadena de auditoría de Python.
- JavaScript disponible: **43/43** pruebas aprobadas (la suite omite solo `tests/integrity.test.js`, que importa `fflate`).
- Python del importador PC: **9/9** pruebas aprobadas.
- `verify-phase1.sh`, `verify-phase3.sh` y `verify-phase4.sh`: código de salida 0.
- Catálogo demo: 3 productos, suma $6.00 USD y SHA-256 válido.

## Pendientes obligatorios antes de producción

1. **Dinero en enteros:** el esquema y los cálculos todavía usan valores decimales (`REAL`/`Number`) en importes. La especificación exige centavos enteros y una migración histórica probada. No se hizo una conversión parcial porque mezclar importes en unidades y centavos dañaría ventas existentes.
2. **Respaldos automáticos cifrados:** sigue existiendo respaldo manual firmado con SHA-256, pero falta generar automáticamente un respaldo cifrado diario y otro antes de migraciones/actualizaciones. El SHA-256 detecta alteración; no cifra ni protege la confidencialidad.
3. **Suite completa:** `tests/integrity.test.js` depende de `fflate`. En este entorno no se pudo instalar la dependencia por fallo de red al acceder al registro npm. La suite íntegra debe ejecutarse con `npm install && npm test`.
4. **Compilación APK:** no se generó APK en este entorno. No hay Android SDK/Gradle disponibles y la descarga de dependencias npm falló. La carpeta contiene el proyecto fuente, no un binario nuevo instalable.
5. **Hardware real:** falta probar en Redmi 14C la Netum L3 por OTG, captura HID sin teclado virtual, uso prolongado, cámara, selector de archivos, compartir por WhatsApp, restauración y migración desde una copia real de la base antigua.
6. **Importador PC:** falta completar la totalidad de alertas avanzadas de la sección 17.7 de la especificación (faltantes repetidos, correcciones frecuentes, cancelaciones con cobros previos y correlaciones temporales).
7. **Firma de actualización:** una actualización sobre la APK ya instalada exige la misma keystore de publicación. Este ZIP no contiene una clave privada ni puede reconstruir la firma de la APK original.
8. **Pruebas de aceptación de punta a punta:** se deben ejecutar con APK compilada: pagos mixtos, eliminar pago, cancelar venta, anulación administrativa, entrada/salida, conteo y revisión, cierre V3, importación PC, duplicados y restauración.

## APK original recibida

La APK adjunta se inspeccionó como binario. Su bundle web no contiene los marcadores/funciones V2 revisados (usuarios dependientes dobles, cancelación lógica V2, estados de pago anulados y módulo de inventario/conteo); corresponde a la aplicación anterior, no al proyecto fuente V2. No es posible convertir un APK binario antiguo en el nuevo proyecto fuente con una edición segura del ZIP: se corrigió el proyecto fuente V2, que debe recompilarse.

## Instrucciones seguras

- Conserva la instalación de trabajo y crea un respaldo manual antes de probar una versión nueva.
- Compila primero `debug` mediante el workflow `.github/workflows/android-apk.yml` en GitHub Actions o un equipo que tenga Node 22, JDK y Android SDK.
- Instala y valida el APK debug en un entorno controlado; no registres ventas reales hasta cerrar los pendientes anteriores.
- No instales `release` encima de la aplicación anterior hasta confirmar que se firma con la misma keystore.

## Resultado

Se corrigieron errores reproducibles en auditoría y conteo, y se añadieron pruebas de regresión. **No puede certificarse que funcione al 100 %**: siguen faltando requisitos obligatorios de integridad monetaria y respaldo, suite completa, compilación Android y validación en hardware. La entrega es un proyecto fuente 2.0.1 corregido para continuar esas pruebas, no un APK de producción.
