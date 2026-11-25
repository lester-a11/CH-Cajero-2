# Fase 4 — integración PC, seguridad, auditoría y publicación

Versión del proyecto: **1.3.0**. Base: documento `Especificación APK Cajero con Pistola Lectora`, especialmente las secciones 10–12 y el Anexo A.5, A.7 y A.10.

## 1. Importador del inventario maestro en Ubuntu

El importador está en `pc/pc_tool.py` y utiliza Python 3, SQLite y bibliotecas estándar. No necesita servidor ni conexión a Internet para trabajar después de preparar el proyecto.

Desde la carpeta raíz:

```bash
python3 pc/pc_tool.py productos
python3 pc/pc_tool.py verificar-cierre "/ruta/al/ventas_AAAA-MM-DD_TIENDA_DISPOSITIVO.zip"
python3 pc/pc_tool.py importar-cierre "/ruta/al/ventas_AAAA-MM-DD_TIENDA_DISPOSITIVO.zip"
python3 pc/pc_tool.py productos
python3 pc/pc_tool.py informe
python3 pc/pc_tool.py auditoria
```

La base maestra se crea en `pc/data/inventario_ch.db`; las fotos importadas se guardan en `pc/fotos/`. Se recomienda respaldar periódicamente ambas ubicaciones.

El importador:

- Acepta el ZIP de cierre que contiene `cierre.json` (y JSON directo compatible).
- Comprueba el SHA-256 del contenido canónico antes de tocar el inventario.
- Exige `id_cierre` y rechaza identificadores ya importados.
- Ejecuta la importación en una transacción SQLite: si falla un paso, revierte todo.
- Descuenta únicamente líneas activas de ventas cerradas; ignora líneas anuladas y ventas anuladas.
- Incorpora productos creados en el teléfono y conserva sus fotos cuando vienen incluidas.
- Registra en `auditoria_pc` las importaciones, exportaciones de catálogo y cambios de productos.
- Mantiene `movimientos_inventario` con altas desde el teléfono, ventas y ajustes manuales de stock.
- Si una venta contiene un código no presente en el catálogo maestro ni en la lista de productos nuevos, deja ese producto con stock negativo y lo señala como advertencia para revisión; no oculta la discrepancia.

El SHA-256 comprueba que el contenido coincide con el hash incluido en el archivo, pero por sí solo no autentica quién lo creó. El HMAC que la especificación contempla como opcional no está activado en esta versión.

Un cierre repetido devuelve código de salida 2 y muestra `DUPLICADO`; no descuenta stock ni crea un segundo evento de importación.

## 2. Usuarios y PIN en Android

La app conserva los dos roles definidos por el documento: `administrador` (dueño) y `dependiente`. La configuración inicial crea ambos usuarios y exige PIN diferentes. Los PIN se almacenan como PBKDF2-HMAC-SHA-256 con sal aleatoria; nunca se guarda el PIN en texto plano.

Desde Administración → Usuarios se pueden crear usuarios y activar/desactivar accesos con autorización del administrador. No se permite desactivar al último administrador activo. Los PIN nuevos deben tener entre 4 y 8 dígitos.

## 3. Auditoría

El administrador dispone de la vista Auditoría en la navegación. Muestra los últimos 250 eventos locales con fecha, usuario, acción y detalle. Las acciones sensibles continúan registrándose en la tabla `auditoria`, incluyendo altas y cambios de usuarios, importaciones, corrección de tasa, recargo, anulaciones, respaldos y cierre diario.

En la PC, `python3 pc/pc_tool.py auditoria` muestra las acciones del inventario maestro.

## 4. APK firmado — clave propiedad del dueño

**No se incluye una keystore en el ZIP.** La clave privada y sus contraseñas deben crearse y custodiarse por el dueño. No deben enviarse por WhatsApp ni incorporarse al repositorio.

En un equipo de confianza, crea la keystore una sola vez (elige contraseñas propias y guárdalas en un gestor seguro):

```bash
keytool -genkeypair -v \
  -keystore ch-cajero-release.jks \
  -alias ch-cajero \
  -keyalg RSA -keysize 2048 -validity 10000
```

Conserva una copia de `ch-cajero-release.jks` fuera de GitHub y fuera de la carpeta pública del proyecto. Para GitHub Actions, convierte una copia a Base64:

```bash
base64 -w 0 ch-cajero-release.jks > ch-cajero-release.base64.txt
```

En el repositorio GitHub, abre **Settings → Secrets and variables → Actions → New repository secret** y crea exactamente estos secretos:

- `ANDROID_KEYSTORE_BASE64`: contenido del archivo Base64.
- `ANDROID_KEYSTORE_PASSWORD`: contraseña del keystore.
- `ANDROID_KEY_ALIAS`: `ch-cajero` (o el alias elegido al crearla).
- `ANDROID_KEY_PASSWORD`: contraseña de la clave.

No publiques el archivo `.jks`, el `.base64.txt` ni las contraseñas en Git. El `.gitignore` excluye estos archivos.

### Compilar

1. Sube el contenido del proyecto a un repositorio privado.
2. Abre **Actions → Compilar CH Cajero APK → Run workflow**.
3. Para prueba inicial, selecciona `debug`; descarga `CH-Cajero-APK-debug`.
4. Para publicación, configura primero los cuatro secretos y selecciona `release`; descarga `CH-Cajero-APK-release` y su SHA-256.
5. Guarda el APK y su checksum junto con la copia de seguridad de la keystore.

El workflow falla deliberadamente si se solicita `release` y falta cualquiera de los secretos. No se debe distribuir un APK debug como versión definitiva.

## 5. Instalación en Android / Redmi

1. Copia el APK al teléfono mediante cable o WhatsApp.
2. Abre el APK desde Archivos/Descargas y autoriza temporalmente la instalación desde esa fuente cuando Android lo solicite.
3. Instala y abre CH Cajero. En la primera ejecución crea el PIN del administrador y del dependiente.
4. Para el Redmi/Xiaomi, permite el inicio automático de CH Cajero y evita que el ahorro de batería restrinja la aplicación, como indica la especificación.
5. Conecta la Netum L3 mediante OTG y realiza la prueba de lectura física.

Las actualizaciones release deben firmarse siempre con la misma keystore. Si se pierde, Android no permitirá instalar la actualización sobre la app firmada anteriormente; conserva la copia fuera de GitHub.

## 6. Prueba de aceptación de Fase 4

1. En la PC, registra un producto de prueba con stock conocido, por ejemplo 10 unidades.
2. En el teléfono, vende y cierra una unidad; genera y comparte el cierre ZIP.
3. Copia el archivo recibido a Ubuntu y ejecuta `importar-cierre`.
4. Ejecuta `productos`: el stock maestro debe mostrar 9.
5. Importa de nuevo exactamente el mismo ZIP: debe aparecer `DUPLICADO`, código de salida 2, y el stock debe permanecer en 9.
6. Ejecuta `auditoria`: debe aparecer una importación, no dos.

Las pruebas automatizadas cubren importación, integridad, duplicado, descuento de stock, auditoría y hashing de PIN. La recepción real por WhatsApp, instalación y lectura de pistola requieren tus dispositivos.
