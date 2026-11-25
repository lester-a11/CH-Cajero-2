# Fase 3 — Funciones nativas, importación, cierre diario y respaldo

Versión del proyecto: **1.2.0**

Esta fase implementa los puntos de la especificación base: 6.1 compartir cierres, 6.2 importar catálogos/productos, 6.3 cámara para fotografías, 6.4 respaldo; además, incorpora el cierre de caja diario descrito en 3.8 y la prueba de aceptación de la fase 3 descrita en la sección 12.

## 1. Compartir y conservar el cierre

- La app genera un ZIP con `cierre.json`.
- El contenido incluye `tipo=cierre_ventas`, `version=1`, UUID único, tienda, dispositivo, fecha, tasa, ventas, anulaciones, productos nuevos pendientes, resumen de caja y stock final.
- El JSON se firma con SHA-256 sobre su representación canónica.
- El archivo se escribe en el almacenamiento privado de la app y se abre el Share Sheet nativo de Android; el dependiente elige WhatsApp u otra aplicación instalada.
- El cierre queda registrado en SQLite y puede compartirse de nuevo desde Administración → Historial de cierres.
- La jornada no se cierra si hay ventas abiertas o pausadas.

## 2. Importar catálogo y productos

- Importación por selector nativo de archivos Android.
- Acepta ZIP con `catalogo.json` y carpeta `fotos/`, JSON de producto individual y JSON de lista de productos compatible.
- Verifica SHA-256 antes de mostrar la vista previa.
- La vista previa informa productos nuevos, actualizados y errores; no modifica la base hasta confirmar.
- La clave de producto es `codigo`; una importación repetida actualiza, no duplica.
- Sin `inventario_corregido`, se actualizan nombre, precio y foto, pero se conserva el stock local de productos existentes.
- Con `inventario_corregido=true`, solicita confirmación adicional y reemplaza también el stock existente.
- Los productos nuevos reciben el stock incluido en el archivo.
- Rechaza códigos repetidos en el mismo archivo, rutas de foto absolutas o con `..`, fotos ausentes y registros inválidos.
- Las acciones de importación requieren PIN de administrador y quedan en auditoría.

## 3. Alta de productos y fotografía

- El producto nuevo solicita código, nombre, precio USD, stock inicial y PIN autorizado.
- Permite cámara/galería mediante Capacitor Camera.
- La imagen se convierte a JPEG y se intenta comprimir a aproximadamente 30 KB, según la especificación.
- Se guarda en la base local como Base64, marcado `origen=app` y `pendiente_sync=1`.
- Los productos nuevos pendientes se incluyen en el cierre para que el dueño los incorpore al catálogo maestro.

## 4. Cierre de caja

El resumen previo al cierre presenta:
- cantidad de ventas cerradas;
- total vendido en USD;
- anulaciones;
- importes brutos recibidos por método;
- efectivo USD esperado y efectivo CUP esperado, descontando el vuelto en la moneda elegida;
- transferencias registradas.

Al confirmar se genera y guarda el archivo ZIP, se comparte por el menú Android y la jornada queda bloqueada. No se puede cerrar con ventas abiertas o pausadas.

## 5. Respaldo y restauración

- Respaldo completo en ZIP con `respaldo.json` y SHA-256.
- Incluye productos, usuarios, configuración, jornadas, ventas, líneas, pagos, cierres y auditoría.
- El respaldo se guarda en el almacenamiento privado y se ofrece al Share Sheet para conservarlo fuera del teléfono.
- Restaurar exige PIN de administrador, valida hash, tablas, columnas y tipos de registros, muestra conteos y exige confirmación explícita.
- La restauración reemplaza las tablas locales dentro de una transacción. Después solicita iniciar sesión con un usuario incluido en el respaldo.

## 6. Verificación automatizada

Ejecutar:

```bash
bash scripts/verify-phase3.sh
```

Incluye las pruebas de Fase 1, Fase 2, Fase 3 y el importador Python de Ubuntu. Las pruebas cubren planificación de importación, preservación de stock, inventario corregido, códigos repetidos, validación de respaldos y cálculo del resumen de caja.

## 7. Validación física pendiente

La prueba de aceptación de fase 3 requiere compilar e instalar la APK en Android, importar un catálogo ZIP real, compartir el cierre por WhatsApp a otro teléfono y comprobar allí el SHA-256. También se debe probar cámara/galería y respaldo/restauración en el Redmi 14C. Estas pruebas no se declaran realizadas por las pruebas unitarias.
