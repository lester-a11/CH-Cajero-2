# Informe de actualización — CH Cajero V2

**Fecha de referencia:** 24 de noviembre de 2026  
**Fuente recibida:** `CH_Cajero_Fase4(1).zip` (proyecto fuente 1.3.0)  
**Especificación:** `Especificacion_CH_Cajero_V2_con_logo.docx`  
**Entrega:** proyecto fuente actualizado a 2.0.0; no incluye APK compilado.

## Trabajo realizado

Se actualizó el proyecto fuente conservando la arquitectura Capacitor, la interfaz web, SQLite local, la integración Android y el funcionamiento offline. Se añadieron las funciones principales de la V2: usuarios dependientes con PIN y turnos, pantalla de inicio con el logotipo CH, navegación de Inventario, pagos anulables individualmente, cancelación lógica de ventas abiertas/pausadas, operaciones de inventario, conteo ciego/reconteo, cierre diario V3 y soporte V1/V2/V3 en el importador PC.

Se amplió el esquema SQLite con migración de compatibilidad para los estados nuevos. Se agregaron pruebas para los flujos de pagos/cancelaciones y para el importador V2/V3. La versión fuente se elevó a 2.0.0 y el proyecto Android quedó configurado para `versionCode 4` y `versionName 2.0.0`.

## Resultado de pruebas en este entorno

- Verificador `scripts/verify-phase4.sh`: correcto.
- Pruebas JavaScript disponibles: 33/33 aprobadas.
- Pruebas Python del importador PC: 9/9 aprobadas.
- Comprobaciones sintácticas JavaScript y Python: correctas.
- La prueba `tests/integrity.test.js` no se ejecutó porque no está instalada `fflate`. La instalación de dependencias npm agotó el tiempo de descarga.

## Límites importantes

Esta entrega no debe confundirse con un APK release listo para instalar. No fue posible ejecutar `npm run build` ni compilar con Android SDK/Gradle en este entorno; el ZIP recibido era el proyecto fuente, no un APK binario.

Antes de producción faltan requisitos obligatorios de V2:

1. Migrar los importes a enteros (centavos) en almacenamiento y cálculos, con conversión probada de datos históricos. El código actual aún usa números decimales.
2. Implementar los respaldos automáticos cifrados diarios y previos a migraciones/actualizaciones. El respaldo manual existente no sustituye este requisito.
3. Ejecutar la suite integral con `npm install && npm test`, incluido `tests/integrity.test.js`.
4. Completar las alertas avanzadas del importador PC que pide la especificación.
5. Validar migración de una copia real de la base de datos, pistola Netum L3 por OTG, Redmi 14C, uso sin teclado virtual, compartir por WhatsApp, cámara, importación y restauración.

Para actualizar una instalación existente se debe conservar la misma keystore con la que se firmó la APK instalada. No se incluye ni se genera una clave privada. Sin esa keystore, un APK release nuevo normalmente no podrá instalarse como actualización encima de la aplicación anterior.

## Recomendación de uso

Conserva la instalación actual y crea primero un respaldo desde ella. Usa el proyecto actualizado para compilar un APK `debug` en GitHub Actions y probarlo en un entorno controlado. No sustituyas la APK de trabajo ni registres ventas reales con esta versión hasta resolver los requisitos obligatorios y validar la migración y el funcionamiento físico.
