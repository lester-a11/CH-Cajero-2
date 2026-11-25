# Informe de reparación y verificación — CH Cajero V2.0.1

**Fecha de revisión:** 25 de noviembre de 2026  
**Material recibido:** `CH_Cajero_V2_actualizado.zip`, `app-debug.apk`, especificación V2 e informe de actualización.  
**Entrega de esta revisión:** proyecto fuente reparado 2.0.1. No se entrega un APK nuevo porque no pudo compilarse en este entorno.

## Veredicto

Se corrigieron defectos reales de auditoría y conteo encontrados al comparar el código con la especificación. La batería de pruebas que sí pudo ejecutarse pasó: **43/43 pruebas JavaScript disponibles y 9/9 pruebas Python**. Esto no permite certificar funcionamiento al 100 %: permanecen requisitos obligatorios no implementados y faltan compilación Android y pruebas en el teléfono y la pistola física.

## Correcciones aplicadas

### 1. Auditoría — fallo bloqueante

La función `audit()` intentaba incluir `accion` como una variable JavaScript, aunque el parámetro de función se llama `action`. Eso produce `ReferenceError` cuando se registra una operación y puede revertir transacciones que dependen de la auditoría.

Se centralizó la construcción del evento en `src/app/audit-event.js`. El parámetro JS `action` ahora se guarda bajo el nombre contractual `accion`, manteniendo la estructura que utiliza la base de datos y el importador Python. Se añadieron pruebas para la estructura, rechazo de acciones vacías y digest SHA-256. Además, se verificó una cadena de evento generada desde JavaScript con el verificador de auditoría del importador Python.

### 2. Conteo ciego y reconteo

Se ajustó el flujo a las reglas de la sección 17 de la especificación:

- Cuando el primer conteo no tiene diferencias, no se solicita un reconteo aleatorio.
- Cuando hay diferencias, se incluyen todos los productos discrepantes y una muestra aleatoria del 20 % de los productos que sí coincidían.
- Si las dos cantidades del dependiente son distintas, el registro queda `inconsistente` y visible para el administrador.
- Si ambas cantidades coinciden entre sí, pero no con el stock esperado, queda `pendiente_verificar`.
- Solo si las dos cantidades son iguales al stock esperado se confirma automáticamente.
- La lista administrativa contempla ambos estados pendientes.
- Durante el reconteo se ocultan al dependiente las cantidades anteriores y actuales; la interfaz solo indica “Pendiente de reconteo” o “Reconteo registrado”.

Se añadieron pruebas para las tres salidas del reconteo, la selección del 20 % y el indicador neutro que no revela cantidades.

### 3. Verificador de fase 1

El verificador estaba pasando un ZIP de catálogo al lector de cierres de ventas. Se corrigió para abrir el ZIP de catálogo, localizar un único `catalogo.json`, verificar su hash y comprobar los tres códigos demo y el total de $6.00 USD.

### 4. Versión

- Proyecto: `2.0.1`.
- Android configurado: `versionCode 5`, `versionName 2.0.1`.
- Se actualizó `ESTADO.md`, `README.md` y `CHANGELOG_V2.md` para distinguir las correcciones verificadas de los pendientes.

## Resultados de pruebas

| Verificación | Resultado |
|---|---:|
| JavaScript disponible | **43/43 aprobadas** |
| Importador PC (Python) | **9/9 aprobadas** |
| `scripts/verify-phase1.sh` | Correcto, salida 0 |
| `scripts/verify-phase3.sh` | Correcto, salida 0 |
| `scripts/verify-phase4.sh` | Correcto, salida 0, con limitación indicada |
| Sintaxis JavaScript | Correcta |
| Sintaxis Python | Correcta |
| Catálogo demo y SHA-256 | 3 productos y $6.00 USD, correcto |
| SHA de auditoría JS → verificador PC | Verificado para evento de prueba |

### Limitaciones de la suite

`tests/integrity.test.js` depende de `fflate`. No se ejecutó porque la dependencia no estaba instalada y la descarga con npm falló al resolver el registro (`EAI_AGAIN`). El verificador de fase 4 ejecutó las otras pruebas y declaró expresamente la omisión. Por eso el resultado correcto es 42 pruebas disponibles, no la suite integral completa.

## Comparación con la especificación: requisitos todavía pendientes

1. **Importes como enteros (centavos):** la base SQLite continúa almacenando importes como `REAL` y la lógica usa números JavaScript. La especificación exige enteros. No apliqué una conversión superficial: requiere añadir columnas/versión de esquema, convertir históricos con una regla única, validar totales, pagos, tasas, vuelto y cierres, y comprobar restauración. Hasta realizar esa migración probada, este requisito no está cumplido.
2. **Respaldos automáticos cifrados:** hoy existe respaldo manual firmado con SHA-256. Un hash detecta alteraciones, pero no cifra. Faltan el respaldo automático diario y el previo a migraciones/actualizaciones, cifrado con gestión de clave adecuada y probado en restauración. No se debe llamar “cifrado” al hash actual.
3. **Alertas avanzadas PC:** faltan todas las alertas analíticas descritas en la sección 17.7: faltantes repetidos por producto, correcciones frecuentes tras reconteo, ventas canceladas con cobros previos y correlación temporal de conteos y salidas grandes.
4. **Suite completa:** instalar `fflate` y ejecutar `npm install && npm test`; el test de integridad omitido debe pasar.
5. **Compilación APK:** no se produjo un APK nuevo. En este entorno no se encontró `adb`, `gradle`, `aapt`, `apksigner`, `ANDROID_HOME` ni `ANDROID_SDK_ROOT`; por tanto no hubo `npm run build`, `npx cap sync android` ni Gradle.
6. **Validación física:** faltan las pruebas en Redmi 14C con Netum L3 por OTG, captura de teclado HID sin teclado virtual, cámara, selección/importación de archivos, compartir mediante WhatsApp, respaldo/restauración y migración de una copia real de la base de datos instalada.
7. **Firma:** para actualizar encima de la APK existente hace falta la misma keystore de publicación. No se proporcionó ni se puede recuperar desde el código fuente.

## Sobre la APK original recibida

La APK adjunta no contiene el bundle V2 que se espera en el ZIP de código fuente: en su JavaScript empaquetado no aparecen los flujos de pagos anulables, ventas canceladas ni el módulo de movimientos/conteo de inventario de V2. Es la compilación anterior y no puede actualizarse de forma fiable editando el binario. Las correcciones se aplicaron al proyecto fuente V2, que necesita compilarse de nuevo.

## Recomendación de uso

No sustituyas todavía la APK de trabajo ni registres ventas reales con esta entrega. Conserva el original y crea un respaldo manual. Compila un `debug` desde GitHub Actions o un entorno con dependencias y SDK Android; después ejecuta la aceptación en el Redmi 14C con la Netum L3 y prueba una copia de la base histórica. No publiques ni instales un `release` hasta confirmar la keystore correcta y cerrar los pendientes obligatorios.

## Resultado final

La fuente se entrega reparada como **CH Cajero V2.0.1**, con dos defectos funcionales corregidos y pruebas de regresión. **No se certifica al 100 % ni se entrega APK compilado**: dinero en centavos, respaldo automático cifrado, alertas avanzadas, suite integral, compilación y pruebas físicas siguen pendientes.
