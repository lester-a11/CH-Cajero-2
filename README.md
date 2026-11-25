# CH Cajero — aplicación Android offline

**Versión del proyecto: 2.0.0 — actualización de código conforme a la especificación V2; validación final pendiente.**

Proyecto de cajero para CH Electronic / Componentes Habana, basado en **Especificación: CH Cajero – APK Android con pistola lectora, versión 2.0 (24 nov 2026)**. La aplicación móvil es un cajero: el catálogo maestro y el inventario global permanecen en la PC Ubuntu. El teléfono trabaja sin internet después de instalarse y recibe/envía archivos manualmente.

## Versión 2.0.0 — actualización de especificación V2

Esta entrega actualiza el código fuente a la especificación V2. Incluye estados de pago activo/anulado, eliminación lógica de pagos, cancelación de ventas abiertas o pausadas, separación entre cancelación y anulación administrativa de ventas cerradas, usuarios y turnos, pantalla de inicio CH, navegación inferior con Inventario, entradas/salidas/conteo semanal y exportación de cierre diario V3. El importador de la PC acepta cierres V1, V2 y V3, verifica la integridad y evita aplicar dos veces un mismo cierre.

**Importante:** esta entrega es una actualización del código fuente, no un APK ya compilado ni certificado para operar en producción. Antes de usarla con ventas reales deben completarse los pendientes obligatorios descritos en `ESTADO.md`: importes almacenados como centavos enteros y respaldo automático cifrado, además de la compilación y pruebas físicas en el Redmi 14C con la Netum L3. No reemplaces la instalación actual hasta validar migración y firma.

## Contenido

- `src/`: interfaz, lógica de caja, pagos, catálogo local, cierres, auditoría y respaldos.
- `android-template/`: código Java nativo para SQLite, captura USB HID y selector de archivos.
- `scripts/prepare-android.mjs`: integra los componentes nativos en el proyecto Android generado por Capacitor.
- `.github/workflows/android-apk.yml`: compila el APK en GitHub Actions.
- `pc/pc_tool.py`: inventario maestro SQLite, importador de cierres, exportador de catálogos y reportes.
- `tests/`: pruebas de escáner, carrito, cálculos de pago, ciclo de venta, integridad, importación y duplicados.
- `ESTADO.md`: estado de construcción y pruebas pendientes.

## APK mediante GitHub Actions

Este repositorio usa Capacitor 8, Node.js 22 y JDK 21. La versión actual de Capacitor exige Node.js 22 o superior y Android API 24 o superior; el JDK lo prepara el flujo de Android. La especificación inicial mencionaba Java 17, pero el entorno de compilación de Capacitor 8 utiliza una cadena Android más reciente. La decisión de compilar en GitHub Actions sí se conserva.

1. Crea un repositorio privado en GitHub y sube el contenido de esta carpeta.
2. Abre **Actions → Compilar CH Cajero APK → Run workflow**.
3. Selecciona `debug` para la primera instalación de prueba.
4. Al terminar, abre la ejecución y descarga el artefacto `CH-Cajero-APK-debug`.
5. Copia el APK al Redmi 14C e instálalo. Android puede pedir autorización para instalar aplicaciones procedentes de esa fuente.

### APK firmado de publicación

La clave de firma debe pertenecer al dueño. No se incluye ninguna contraseña ni keystore en este ZIP.

Crea una keystore una sola vez en un equipo bajo tu control y conserva una copia fuera de GitHub. En el repositorio configura estos **GitHub Actions Secrets**:

- `ANDROID_KEYSTORE_BASE64`: contenido de la keystore convertido a Base64.
- `ANDROID_KEYSTORE_PASSWORD`: contraseña de la keystore.
- `ANDROID_KEY_ALIAS`: alias de la clave.
- `ANDROID_KEY_PASSWORD`: contraseña de la clave.

Después ejecuta el workflow con `release`. La compilación release falla de forma deliberada si falta la clave. No pierdas la keystore: las actualizaciones firmadas deben conservar la misma identidad.


## Fase 1 — escáner, catálogo y carrito

La Fase 1 deja la base de caja preparada para la prueba de aceptación definida en la especificación: lector USB HID, tarjeta de producto, carrito con miniatura, botones +/− y entrada numérica de cantidad, y total en USD. El código del lector se procesa como texto y no requiere que haya un campo de texto enfocado. El lector se desactiva al enfocar el campo de código manual, la cantidad o cualquier otro campo editable.

### Catálogo de demostración

Incluido en `examples/catalogo_prueba_fase1.zip`. Contiene tres productos de prueba a $1, $2 y $3 USD, cada uno con stock 30. El archivo tiene SHA-256 válido y no altera el stock de productos existentes porque no está marcado como inventario corregido.

Códigos del catálogo: 

| Código | Producto | Precio |
| --- | --- | ---: |
| `6971449709288` | Producto DEMO 01 | $1.00 |
| `2000000000015` | Producto DEMO 02 | $2.00 |
| `2000000000022` | Producto DEMO 03 | $3.00 |

Los códigos deben estar impresos en etiquetas 1D compatibles con el lector. Incluyo `examples/etiquetas_prueba_ean13.svg` con las tres etiquetas EAN-13 para imprimir en papel mate al 100 % de escala, sin plastificar. El primer código coincide con el EAN-13 que ya se probó con la Netum L3 según la especificación; los otros dos son códigos de demostración.

### Preparación y prueba

1. Genera el APK debug con GitHub Actions siguiendo la sección anterior e instálalo en el Redmi 14C.
2. Abre CH Cajero y crea el PIN del administrador y el del dependiente. Deben ser distintos.
3. Entra como administrador y abre la caja introduciendo la tasa CUP/USD. Para esta prueba puedes introducir `500`; no es un dato de venta real.
4. Copia `examples/catalogo_prueba_fase1.zip` al teléfono (por cable o WhatsApp), ve a **Administración → Importar catálogo** y selecciona ese archivo desde Descargas.
5. Regresa a **Caja** y conecta la Netum L3 mediante el adaptador OTG. El indicador debe cambiar de **ESPERANDO LECTOR** a **PISTOLA CONECTADA** cuando Android exponga el HID físico.
6. Escanea un código. Debe aparecer la tarjeta correspondiente sin abrir el teclado en pantalla. Pulsa **Añadir**; repite con los otros dos códigos.
7. El carrito debe mostrar tres líneas y el total debe ser **$6.00 USD**.
8. Repite un código para confirmar que se acumula en la misma línea. El total debe aumentar según el precio de ese producto.

Para probar sin la pistola, el campo **Código manual** permite buscar un código escrito; en ese caso el teclado en pantalla es normal y no cuenta como prueba del lector.

### Pruebas ejecutables

Desde la raíz del proyecto, ejecuta el verificador que comprueba las pruebas de Fase 1 y 2, las pruebas Python, la sintaxis JavaScript y el hash/códigos del catálogo de demostración:

```bash
bash scripts/verify-phase1.sh
```

La compilación APK requiere instalar dependencias npm y se ejecuta en el workflow de GitHub Actions.

La prueba física de lectura y la ausencia del teclado virtual solo se pueden declarar superadas después de ejecutar los pasos anteriores con la Netum L3 y el Redmi 14C.


## Fase 2 — pagos, ventas pausadas, cierre e historial

La Fase 2 implementa los requisitos 3.3, 3.4 y 3.5 y el criterio de aceptación de la especificación. El importe base de la venta permanece en USD. Cada pago queda guardado con método, monto original, moneda, tasa aplicada y equivalente USD; el saldo se calcula con esos equivalentes.

### Reglas de cobro implementadas

- **USD efectivo:** 1 USD recibido acredita 1 USD; no lleva recargo.
- **CUP efectivo:** se convierte dividiendo el monto recibido entre la tasa CUP/USD; no lleva recargo.
- **Transferencia:** el cliente transfiere `saldo_USD × tasa × 1.20` CUP si el recargo configurado es 20 %. El equivalente acreditado es `(CUP transferidos / 1.20) / tasa`. En pantalla se muestra el importe CUP final con recargo.
- Se pueden registrar pagos de los tres métodos en una misma venta. La pantalla muestra `FALTA` mientras el saldo sea positivo y `LISTO` al cubrirlo.
- El cierre de la venta se bloquea mientras exista saldo pendiente. Un pago superior al total produce vuelto calculado en USD o CUP; la moneda del vuelto se elige antes de cerrar.
- Los importes originales de pagos se normalizan a dos decimales antes de guardarse. El teclado numérico limita la entrada a dos decimales.

### Pausar y retomar

En Caja, pulsa **Pausar** para guardar la venta con estado `pausada`. Puedes atender otro cliente y abrir otra venta. La sección **Ventas en pausa** permite retomarla; las líneas y los pagos previamente registrados permanecen vinculados a esa venta.

### Historial y anulaciones

**Historial** muestra ventas del día y su estado. En **Detalle** se ven productos, pagos, tasa y recargo históricos. Anular una línea o una venta completa solicita motivo y PIN del administrador. La operación se conserva en el historial y queda en auditoría; al anular líneas o ventas cerradas se repone únicamente el stock que no se había repuesto antes.

### Parámetros del día

La tasa debe introducirse y confirmarse al abrir la jornada. Queda fija para las ventas nuevas del día. Solo el administrador, con PIN, puede corregirla; la corrección se aplica a ventas futuras y las ventas existentes conservan su propia tasa. El recargo también requiere PIN administrativo y solo afecta a nuevas ventas.

### Prueba manual de aceptación Fase 2

Usa el catálogo demo de tres productos ($1, $2 y $3; total $6) y una tasa de prueba de `500 CUP/USD`:

1. Crea una venta con los tres productos. Pulsa **Cobrar**.
2. Registra `1.00 USD` en efectivo: el saldo debe quedar en `$5.00`.
3. Selecciona CUP efectivo y registra `500 CUP`: el saldo debe quedar en `$4.00`.
4. Selecciona Transferencia. La pantalla debe recomendar `2400.00 CUP` (4 × 500 × 1.20). Registra `2400.00 CUP`: debe aparecer **LISTO**.
5. Pulsa **Cerrar venta y descontar stock**. El historial debe mostrar la venta cerrada y el stock debe haber disminuido una unidad en cada producto.
6. Para probar vuelto, crea otra venta de `$1.00`, recibe `$2.00 USD`, selecciona CUP para el vuelto y confirma que muestra `500 CUP` antes de cerrar.
7. Para probar pausa, crea otra venta, añade un producto, pulsa **Pausar**, abre otra venta y luego retoma la primera desde **Ventas en pausa**.
8. Para probar anulación, cierra una venta de prueba, abre su detalle desde **Historial** y anula una línea con motivo y PIN del administrador. Confirma que la línea queda marcada y el stock correspondiente se repone.

La especificación no define un procedimiento separado de devolución de dinero cuando se anula una venta que ya recibió pagos; esta versión conserva los pagos históricos y el motivo de anulación, sin inventar un flujo de reembolso distinto al documento.

### Pruebas automáticas de Fase 2

`npm run test:phase2` ejecuta las pruebas de los tres métodos, cálculo mixto, recargo de transferencia, saldo, vuelto USD/CUP, bloqueo de cierre con saldo pendiente, redondeo a centavos y reposición de stock sin duplicar líneas ya anuladas.

Para ejecutar las comprobaciones del proyecto:

```bash
npm install
npm run test:phase1
npm run test:phase2
npm test
python3 -m unittest discover -s tests -p 'test_*.py' -v
```


## Preparar el inventario maestro en Ubuntu

No requiere servidor ni conexión permanente. Python 3 y SQLite forman parte del flujo; el programa solo utiliza la biblioteca estándar.

Desde la raíz del proyecto:

```bash
python3 pc/pc_tool.py productos
```

La primera ejecución crea `pc/data/inventario_ch.db` y la carpeta `pc/fotos/`.

Crear o actualizar un producto del catálogo maestro:

```bash
python3 pc/pc_tool.py producto \
  --codigo "6971449709288" \
  --nombre "Producto de prueba" \
  --precio-usd 1.50 \
  --stock 25
```

Exportar el catálogo para el teléfono:

```bash
python3 pc/pc_tool.py exportar-catalogo --salida catalogo_2026-11-18.zip
```

Ese catálogo actualiza por código nombre, precio y foto. **No reemplaza el stock local de productos que ya existen** salvo que se exporte expresamente con `--inventario-corregido`; en el teléfono, esa marca exige confirmación y PIN administrativo.

Importar el ZIP de cierre que el dependiente envía desde WhatsApp:

```bash
python3 pc/pc_tool.py importar-cierre "/ruta/al/archivo/ventas_2026-11-18_CH_DEVICE.zip"
```

Un mismo `id_cierre` solo se importa una vez. Si se reenvía el mismo archivo, la PC lo rechaza como duplicado y no vuelve a descontar stock.

Ver el informe de la semana actual:

```bash
python3 pc/pc_tool.py informe
```

Ver un rango concreto:

```bash
python3 pc/pc_tool.py informe --desde 2026-11-16 --hasta 2026-11-22
```

## Reglas implementadas

- El código del producto se guarda como texto; no se fuerza EAN/UPC/Code 128. La app trabaja con lo que entrega la pistola.
- La jornada requiere apertura y confirmación de tasa. El administrador puede corregirla; las ventas anteriores mantienen su propia tasa.
- CUP en efectivo no lleva recargo. La transferencia usa `monto_pendiente_usd × tasa × 1.20`; el abono nominal se calcula dividiendo el monto transferido entre `1.20` y luego entre la tasa.
- Los pagos combinados se convierten a USD y el cobro no puede cerrarse si queda saldo pendiente.
- El vuelto puede entregarse en USD o CUP en efectivo.
- Los productos creados en el teléfono quedan marcados como pendientes y se incluyen en los cierres.
- Las anulaciones requieren motivo y PIN administrativo; no se borran del historial. Si la venta ya había descontado stock, la anulación lo repone.
- El catálogo se importa mediante ZIP con `catalogo.json` y fotos. La importación hace upsert por código y no duplica productos.
- Los cierres y respaldos son ZIP con JSON y SHA-256. El hash detecta daños o modificaciones respecto al contenido firmado; no es una firma de identidad como HMAC.
- Los archivos se intercambian manualmente por WhatsApp u otro medio; no hay sincronización de red.

## Pruebas automáticas

Con Node.js 22 y las dependencias instaladas:

```bash
npm install
npm test
python3 -m unittest discover -s tests -p 'test_pc_import.py' -v
```

## Prueba física obligatoria

La compilación no sustituye la comprobación en el hardware real. En el Redmi 14C:

1. Conecta la Netum L3 por USB-A → OTG USB-C.
2. Abre Caja sin enfocar el campo de código manual.
3. Escanea al menos tres códigos distintos y comprueba que no aparezca el teclado en pantalla.
4. Verifica que la tarjeta y el carrito correspondan al código leído.
5. Prueba un código inexistente, alta de producto y fotografía.
6. Con tasa de ejemplo `500`, comprueba: `500 CUP` en efectivo = `1 USD`; `600 CUP` por transferencia = `1 USD` abonado.
7. Prueba un cobro dividido en USD, CUP y transferencia, con vuelto.
8. Pausa y retoma una venta; cierra otra y comprueba el descuento de stock.
9. Anula una línea y una venta con PIN administrativo; comprueba reposición del stock y registro del motivo.
10. Cierra el día, comparte el ZIP y procésalo una vez en Ubuntu. Repite la importación del mismo archivo: debe detectarse como duplicado.

La Netum L3 probada es lectora 1D. La app captura texto de la pistola y queda preparada para entrada 1D/2D, pero la lectura física de QR requiere un lector 2D; no transforma una pistola 1D en 2D.


## Fase 3 (versión 1.2.0)

La Fase 3 incorpora compartir cierres por el Share Sheet de Android, importación de catálogos y productos con vista previa y SHA-256, fotografías comprimidas, resumen de cierre diario y respaldo/restauración completa. Consulta [`docs/FASE3.md`](docs/FASE3.md).

Para verificar las tres primeras fases: `bash scripts/verify-phase3.sh`.


## Fase 4 — integración PC, usuarios, auditoría y APK firmado

La Fase 4 completa el flujo del documento base: importador Python/SQLite en Ubuntu, controles de usuarios con PIN, auditoría local y guía para generar el APK release firmado con una keystore que pertenece al dueño. Consulta [`docs/FASE4.md`](docs/FASE4.md) para los comandos del importador, los secretos requeridos por GitHub Actions, la instalación en Android y la prueba de aceptación.

El administrador puede consultar **Auditoría** desde la navegación y activar/desactivar usuarios con PIN; la aplicación impide desactivar al último administrador activo. El importador de PC registra sus acciones con `python3 pc/pc_tool.py auditoria`.

Para ejecutar las verificaciones de esta entrega: `bash scripts/verify-phase4.sh`. No se declara APK compilado ni firmado en este ZIP: la descarga de dependencias npm no terminó en este entorno y la firma requiere la keystore privada del dueño.
