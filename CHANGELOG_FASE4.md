# Cambios — CH Cajero 1.3.0 (Fase 4)

- Consolidado el proyecto de Fases 1–3 como base de la Fase 4.
- Añadida vista de auditoría para administrador en Android.
- Añadida activación/desactivación de usuarios con PIN administrativo; se protege el último administrador activo.
- Añadido registro de auditoría local del inventario maestro PC para importaciones, exportaciones y cambios de productos.
- Añadidos comandos `auditoria` y `verificar-cierre` al importador de Ubuntu; el inventario PC registra movimientos y eventos de auditoría.
- Añadida prueba de que un cierre duplicado no vuelve a descontar stock ni duplica el evento de importación.
- Añadidas pruebas automatizadas del hash PBKDF2 de PIN.
- Añadida guía de keystore, secretos de GitHub Actions, APK release e instalación Android.
- Añadido verificador unificado `scripts/verify-phase4.sh`.
- No se incluyó una keystore ni contraseñas: pertenecen al dueño.

## Limitaciones de esta entrega

- No se pudo descargar `fflate` desde npm en este entorno; la prueba `tests/integrity.test.js` y el build Vite/Android necesitan que GitHub Actions instale dependencias.
- No se generó APK aquí. La compilación y firma release quedan para el workflow, usando los secretos privados del dueño.
- No se ha probado en físico en Redmi 14C ni con Netum L3.
